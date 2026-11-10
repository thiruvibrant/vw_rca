/**
 * Momentum: is the business speeding up or slowing down? A simple anomaly consensus model, METRIC_DEFINITIONS.md §8.
 *
 * Plain statistics, no ML (classical seasonal adjustment + control-chart rules):
 *  - Season: each day's seasonal strength = last year's normal level for that day (goalCurve.normalLevel) × this year's
 *    holiday factor ÷ last year's trend (the 364-day average centred on that day). Dividing by last year's trend
 *    matters: comparing with last year directly would turn last year's growth into a fake slide this year.
 *  - Expected = seasonal strength × the business's level in the half-year before the recent 16 weeks. So "−5%" means
 *    5% below the recent half-year's pace once season and holidays are taken out.
 *  - Five simple detectors vote dip / rise / nothing; enough votes in one direction make an Alert.
 *
 * Pure functions on plain maps, shared by the snapshot step (analytics/momentum.ts) and the offline test (scripts/momentum.test.ts).
 */
import { addDays, dow, weekStart } from "./dateUtils";
import { calendarEffect, isWeekdayHoliday, normalLevel } from "./goalCurve";

export const MOMENTUM = {
  /** last year's normal level: median of `normalTake` days among ly ± 7 … ± 7·normalReach (goalCurve.normalLevel) */
  normalTake: 12,
  normalReach: 6,
  /** weekly detectors see each business day capped at this many robust SDs of the daily ratio */
  dayCap: 3,
  /** the ladder: last 1, 4, 8 and 16 complete weeks */
  windows: [1, 4, 8, 16] as const,
  /** noise: weekly noise measured over the 52 complete weeks before the recent 16, from week-to-week changes */
  refWeeks: 52,
  /** allowance for correlation between neighbouring weeks (calibrated by simulation, scripts/momentum.test.ts) */
  bandInflation: 1.25,
  /** usual: the level of the 26 weeks just before the recent 16 ("the half-year before") */
  anchorWeeks: 26,
  /** last year's trend: the average daily revenue over this many days centred on the day */
  trendDays: 364,
  /** a window is significant beyond this many noise bands */
  z: 2,
  /** recent days: a day is unusual beyond this many robust SDs of its weekday's last `spikeLookback` season-adjusted ratios */
  spikeZ: 3,
  spikeLookback: 8,
  spikeDays: 5,
  spikeMin: 2,
  /** run rule: `runMin` of the last `runLen` weeks on one side, or `farMin` of the last `farLen` beyond one band */
  runLen: 8,
  runMin: 7,
  farLen: 5,
  farMin: 4,
  /** slope over the last `slopeWeeks` weeks, significant at |t| ≥ slopeT */
  slopeWeeks: 8,
  slopeT: 2.45,
  /** CUSUM on weekly deviations in bands (each week capped at ±3): slack k, alarm at h */
  cusumK: 0.5,
  cusumH: 5,
  alertVotes: 3,
  watchVotes: 2,
};
export type MomentumParams = typeof MOMENTUM;

export type Sign = -1 | 0 | 1;
export type DetectorId = "ladder" | "days" | "run" | "slope" | "cusum";
export type Pattern = "sustained" | "new" | "new-deepening" | "recovering" | "recovered" | "blip" | "steady";
export type MomentumStatus = "alert" | "watch" | "normal";

export type MomentumWindow = {
  weeks: number;
  start: string;
  end: string;
  actual: number;
  /** season × the half-year-before's level for the same days */
  expected: number;
  /** last year's raw revenue on the same days 364 days earlier (for drivers) */
  ly: number;
  /** actual ÷ expected − 1: vs the recent half-year's pace, season and holidays removed */
  pct: number;
  /** actual ÷ ly − 1: plain growth vs the same days last year, for context */
  yoy: number;
  /** (pct − usual) ÷ this window's noise band */
  z: number;
  sig: Sign;
};

export type Momentum = {
  asOf: string;
  /** last day of the last complete Monday–Sunday week */
  weekEnd: string;
  /** median weekly pct in the half-year before the recent 16 weeks (≈ 0 by construction) */
  usual: number;
  /** noise band of one week (robust SD) */
  band: number;
  windows: MomentumWindow[];
  /** the 16 recent complete weeks, oldest first */
  weekly: { start: string; actual: number; expected: number; pct: number }[];
  /** the current, unfinished week (null on a Sunday) */
  thisWeek: { start: string; end: string; actual: number; expected: number; pct: number } | null;
  votes: { id: DetectorId; label: string; vote: Sign; detail: string }[];
  status: MomentumStatus;
  direction: Sign;
  pattern: Pattern;
  /** dip (−1) or rise (+1) the pattern describes */
  patternSign: Sign;
  /** weeks 1–4, 5–8 and 9–16 back, each vs usual */
  blocks: { label: string; start: string; pct: number; z: number; sig: Sign }[];
  /** first week of the shift (CUSUM), when one is under way */
  since: string | null;
  /** the last complete week touches Dec 20 – Jan 3: readings less reliable, Watch at most */
  holidaySeason: boolean;
  headline: string;
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Robust SD: 1.4826 × the median absolute deviation. */
function robustSd(xs: number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map(x => Math.abs(x - m)));
}

/**
 * Dec 20 – Jan 3. Business runs at 40–80% of normal on most weekdays here, not only on the listed holidays
 * (2023–25: Dec 22–23 and 29–30 at 0.56–0.77), so readings are unreliable: the recent-days check skips these days and
 * a week touching them can raise Watch at most.
 */
export function inHolidaySeason(d: string): boolean {
  const md = d.slice(5);
  return md >= "12-20" || md <= "01-03";
}

const sign = (x: number): Sign => (x > 0 ? 1 : x < 0 ? -1 : 0);
const pctText = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A week's sums. `adj` = actual with each business day capped at `dayCap` daily bands (what the detectors use). */
type Week = { start: string; actual: number; adj: number; expected: number; ly: number };
type Day = { d: string; actual: number; expected: number; ly: number; biz: boolean };

/** Seasonal strength of day d (dimensionless; 0 when there isn't enough history). */
function dayOf(revByDay: ReadonlyMap<string, number>, d: string, p: MomentumParams, trendAt: (x: string) => number): Day {
  const k = dow(d);
  const ly = addDays(d, -364);
  const trend = trendAt(ly);
  return {
    d,
    actual: revByDay.get(d) ?? 0,
    expected: trend > 0 ? (normalLevel(revByDay, d, undefined, p.normalTake, p.normalReach) * calendarEffect(d)) / trend : 0,
    ly: revByDay.get(ly) ?? 0,
    biz: k >= 1 && k <= 5 && !isWeekdayHoliday(d),
  };
}

/** Average daily revenue over `n` days centred on x (0 when the window isn't fully covered by the data). */
function trendFn(revByDay: ReadonlyMap<string, number>, n: number): (x: string) => number {
  const keys = [...revByDay.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  const cum = new Map<string, number>();
  let run = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    run += revByDay.get(d) ?? 0;
    cum.set(d, run);
  }
  const back = Math.floor(n / 2);
  return x => {
    const a = addDays(x, -back);
    const b = addDays(x, n - back - 1);
    if (a <= first || b > last) return 0;
    return (cum.get(b)! - cum.get(addDays(a, -1))!) / n;
  };
}

function weekOf(days: Day[], cap: (day: Day) => number): Week {
  return {
    start: days[0].d,
    actual: days.reduce((s, x) => s + x.actual, 0),
    adj: days.reduce((s, x) => s + cap(x), 0),
    expected: days.reduce((s, x) => s + x.expected, 0),
    ly: days.reduce((s, x) => s + x.ly, 0),
  };
}

/** actual ÷ expected − 1 over the weeks; `raw` for display, otherwise the capped actual the detectors use */
const pctOf = (ws: Week[], raw = false) => {
  const e = ws.reduce((s, w) => s + w.expected, 0);
  return e > 0 ? ws.reduce((s, w) => s + (raw ? w.actual : w.adj), 0) / e - 1 : 0;
};

/**
 * The momentum read for data through `asOf` (the snapshot's data-through date). Needs about 2.5 years of daily
 * company revenue before `asOf` (16 + 52 weeks, plus last year's neighbours). Null when there is too little history.
 */
export function momentum(revByDay: ReadonlyMap<string, number>, asOf: string, p: MomentumParams = MOMENTUM): Momentum | null {
  const weekEnd = dow(asOf) === 0 ? asOf : addDays(weekStart(asOf), -1);
  const recentN = Math.max(...p.windows);
  const firstDay = addDays(weekEnd, -7 * (recentN + p.refWeeks) + 1);
  const recentStart = addDays(weekEnd, -7 * recentN + 1);
  const trendAt = trendFn(revByDay, p.trendDays);
  const days: Day[] = [];
  for (let d = firstDay; d <= asOf; d = addDays(d, 1)) days.push(dayOf(revByDay, d, p, trendAt));
  // Expected = seasonal strength × the half-year-before's level (revenue per unit of seasonal strength).
  const anchorStart = addDays(recentStart, -7 * p.anchorWeeks);
  const anchor = days.filter(x => x.d >= anchorStart && x.d < recentStart);
  if (anchor.some(x => x.expected <= 0)) return null;
  const level = anchor.reduce((s, x) => s + x.actual, 0) / anchor.reduce((s, x) => s + x.expected, 0);
  for (const x of days) x.expected *= level;

  // One unusual day mustn't look like a shift: cap each business day at `dayCap` robust SDs of the reference
  // period's daily ratios before the weekly detectors see it. The recent-days detector (D2) still sees the raw day.
  const refDaily = days.filter(x => x.d < recentStart && x.biz && x.expected > 0).map(x => x.actual / x.expected - 1);
  const dayUsual = median(refDaily);
  const dayBand = robustSd(refDaily);
  const cap = (x: Day) => {
    if (!x.biz || x.expected <= 0 || !refDaily.length) return x.actual;
    const r = Math.max(dayUsual - p.dayCap * dayBand, Math.min(dayUsual + p.dayCap * dayBand, x.actual / x.expected - 1));
    return x.expected * (1 + r);
  };

  const all: Week[] = [];
  for (let i = 0; i + 7 <= days.length && days[i + 6].d <= weekEnd; i += 7) {
    const w = weekOf(days.slice(i, i + 7), cap);
    if (w.expected > 0) all.push(w);
  }
  if (all.length < recentN + 26) return null;
  const recent = all.slice(-recentN);
  const ref = all.slice(0, -recentN);
  const weeklyPct = recent.map(w => pctOf([w]));

  // Usual = growth vs last year in the half-year before the recent weeks, so a business whose growth is changing
  // is compared with its recent past, not with last year's very different pace.
  const usual = median(ref.slice(-p.anchorWeeks).map(w => pctOf([w])));
  // Weekly noise σ from week-to-week changes (a slow trend can't inflate it). An n-week window compared with the
  // anchor half-year has noise σ·√(1/n + 1/anchorWeeks), times an allowance for neighbouring weeks moving together.
  const refPct = ref.map(w => pctOf([w]));
  const sigma = Math.max(robustSd(refPct.slice(1).map((x, i) => x - refPct[i])) / Math.SQRT2, 0.005);
  const bandOf = (n: number) => sigma * Math.sqrt(1 / n + 1 / p.anchorWeeks) * p.bandInflation;
  const band = bandOf(1);

  const windows: MomentumWindow[] = p.windows.map(n => {
    const ws = recent.slice(-n);
    const pct = pctOf(ws, true);
    const z = (pctOf(ws) - usual) / bandOf(n);
    const actual = ws.reduce((s, w) => s + w.actual, 0);
    const ly = ws.reduce((s, w) => s + w.ly, 0);
    return {
      weeks: n,
      start: ws[0].start,
      end: weekEnd,
      actual,
      expected: ws.reduce((s, w) => s + w.expected, 0),
      ly,
      pct,
      yoy: ly > 0 ? actual / ly - 1 : 0,
      z,
      sig: Math.abs(z) >= p.z ? sign(z) : 0,
    };
  });
  const win = (n: number) => windows.find(w => w.weeks === n)!;

  // D1 ladder: the 4-week window beyond its noise band.
  const w4 = win(4);
  const d1: Sign = w4.sig;

  // D2 recent days: each of the last business days' season-adjusted ratio (actual ÷ expected) vs the same weekday's
  // previous ratios (median / robust SD). Season-adjusted, so the slow weeks around Christmas don't look like a collapse.
  const byDay = new Map(days.map(x => [x.d, x] as const));
  const ratio = (d: string) => {
    const x = byDay.get(d);
    return x && x.biz && !inHolidaySeason(d) && x.expected > 0 && revByDay.has(d) ? x.actual / x.expected : null;
  };
  const bizDays: string[] = [];
  for (let d = asOf; bizDays.length < p.spikeDays && d > addDays(asOf, -30); d = addDays(d, -1)) {
    if (ratio(d) !== null) bizDays.push(d);
  }
  let lows = 0;
  let highs = 0;
  for (const d of bizDays) {
    const prev: number[] = [];
    for (let k = 1; prev.length < p.spikeLookback && k <= 20; k++) {
      const r = ratio(addDays(d, -7 * k));
      if (r !== null) prev.push(r);
    }
    const m = median(prev);
    const sd = Math.max(robustSd(prev), 0.05 * m);
    if (prev.length < 4 || sd <= 0) continue;
    const z = (ratio(d)! - m) / sd;
    if (z <= -p.spikeZ) lows++;
    if (z >= p.spikeZ) highs++;
  }
  const d2: Sign = lows >= p.spikeMin ? -1 : highs >= p.spikeMin ? 1 : 0;

  // D3 run rule (Western Electric / Nelson style).
  const dev = weeklyPct.map(x => x - usual);
  const lastRun = dev.slice(-p.runLen);
  const lastFar = dev.slice(-p.farLen);
  const d3: Sign =
    lastRun.filter(x => x < 0).length >= p.runMin || lastFar.filter(x => x < -band).length >= p.farMin
      ? -1
      : lastRun.filter(x => x > 0).length >= p.runMin || lastFar.filter(x => x > band).length >= p.farMin
        ? 1
        : 0;

  // D4 slope: least-squares trend of the last weeks' pct, t-statistic.
  const ys = weeklyPct.slice(-p.slopeWeeks);
  const xm = (ys.length - 1) / 2;
  const ym = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxx = 0;
  let sxy = 0;
  ys.forEach((y, x) => {
    sxx += (x - xm) ** 2;
    sxy += (x - xm) * (y - ym);
  });
  const slope = sxy / sxx;
  const sse = ys.reduce((s, y, x) => s + (y - (ym + slope * (x - xm))) ** 2, 0);
  const se = Math.sqrt(sse / Math.max(ys.length - 2, 1) / sxx);
  const t = se > 0 ? slope / se : 0;
  const d4: Sign = Math.abs(t) >= p.slopeT ? sign(t) : 0;

  // D5 CUSUM on weekly deviations in bands; also dates the start of the shift.
  let lo = 0;
  let hi = 0;
  let loStart = 0;
  let hiStart = 0;
  dev.forEach((x, i) => {
    const z = Math.max(-3, Math.min(3, x / band)); // robust CUSUM: one extreme week can't trip it alone
    lo = Math.max(0, lo - z - p.cusumK);
    hi = Math.max(0, hi + z - p.cusumK);
    if (lo === 0) loStart = i + 1;
    if (hi === 0) hiStart = i + 1;
  });
  const d5: Sign = lo >= p.cusumH ? -1 : hi >= p.cusumH ? 1 : 0;
  const shiftStart = d5 === -1 ? loStart : d5 === 1 ? hiStart : -1;

  const votes: Momentum["votes"] = [
    { id: "ladder", label: "4-week level", vote: d1, detail: `${pctText(w4.pct)} vs usual ${pctText(usual)} (${w4.z.toFixed(1)} bands)` },
    { id: "days", label: "Recent days", vote: d2, detail: `${lows} low, ${highs} high of the last ${bizDays.length} business days` },
    { id: "run", label: "Run of weeks", vote: d3, detail: `${lastRun.filter(x => x < 0).length} of the last ${lastRun.length} weeks below usual` },
    { id: "slope", label: "8-week trend", vote: d4, detail: `${pctText(slope)} a week (t = ${t.toFixed(1)})` },
    { id: "cusum", label: "Build-up (CUSUM)", vote: d5, detail: shiftStart >= 0 && shiftStart < recent.length ? `since ${fmtDay(recent[shiftStart].start)}` : "no build-up" },
  ];
  const down = votes.filter(v => v.vote === -1).length;
  const up = votes.filter(v => v.vote === 1).length;
  const top = Math.max(down, up);
  const direction: Sign = down > up ? -1 : up > down ? 1 : top ? sign(w4.pct - usual) : 0;
  const holidaySeason = [0, 1, 2, 3, 4, 5, 6].some(i => inHolidaySeason(addDays(weekEnd, -i)));
  const raw: MomentumStatus = down !== up && top >= p.alertVotes ? "alert" : top >= p.watchVotes ? "watch" : "normal";
  const status: MomentumStatus = holidaySeason && raw === "alert" ? "watch" : raw;

  // Pattern: read the 16 weeks as separate blocks (weeks 1–4, 5–8, 9–16 back), so a recent dip that drags the
  // 16-week average down isn't mistaken for a long one, and a dip that has passed reads as "recovered".
  const blockOf = (label: string, from: number, to: number) => {
    const ws = recent.slice(recent.length - to, recent.length - from + 1);
    const z = (pctOf(ws) - usual) / bandOf(ws.length);
    return { label, start: ws[0].start, pct: pctOf(ws, true), z, sig: (Math.abs(z) >= p.z ? sign(z) : 0) as Sign };
  };
  const blocks = [blockOf("Weeks 1–4", 1, 4), blockOf("Weeks 5–8", 5, 8), blockOf("Weeks 9–16", 9, 16)];
  const [b4, b58, b916] = blocks.map(b => b.sig);
  const s1 = win(1).sig;
  const dev1 = win(1).z * bandOf(1);
  const dev4 = w4.z * bandOf(4);
  const dev58 = blocks[1].z * bandOf(4);
  const pattern: Pattern =
    b4 && b58 === b4 && Math.abs(dev4) < 0.5 * Math.abs(dev58)
      ? "recovering"
      : b4 && b916 === b4
        ? "sustained"
        : b4
          ? sign(dev1) === b4 && Math.abs(dev1) > Math.abs(dev4) ? "new-deepening" : "new"
          : b58 || b916
            ? "recovered"
            : s1
              ? "blip"
              : "steady";
  // The direction the pattern talks about: the latest block that was off.
  const patternSign: Sign = b4 || b58 || b916 || s1;

  const since = shiftStart >= 0 && shiftStart < recent.length ? recent[shiftStart].start : null;
  const thisWeek =
    weekEnd === asOf
      ? null
      : (() => {
          const w = weekOf(days.filter(x => x.d > weekEnd), cap);
          return { start: w.start, end: asOf, actual: w.actual, expected: w.expected, pct: pctOf([w], true) };
        })();

  const m: Momentum = {
    asOf,
    weekEnd,
    usual,
    band,
    windows,
    weekly: recent.map(w => ({ start: w.start, actual: w.actual, expected: w.expected, pct: pctOf([w], true) })),
    thisWeek,
    votes,
    status,
    direction,
    pattern,
    patternSign,
    blocks,
    since,
    holidaySeason,
    headline: "",
  };
  m.headline = headlineOf(m);
  return m;
}

/** One plain sentence for the tile and the feed. */
export function headlineOf(m: Pick<Momentum, "status" | "patternSign" | "pattern" | "since" | "windows" | "holidaySeason">): string {
  const text = sentenceOf(m);
  return m.holidaySeason ? `${text} Holiday season: read with care.` : text;
}

function sentenceOf(m: Pick<Momentum, "status" | "patternSign" | "pattern" | "since" | "windows">): string {
  const w4 = m.windows.find(w => w.weeks === 4)!;
  const word = m.patternSign < 0 ? "dip" : "rise";
  const level = `last 4 weeks ${pctText(w4.pct)} vs the usual pace (season-adjusted), ${pctText(w4.yoy)} vs last year`;
  const since = m.since ? ` since ${fmtDay(m.since)}` : "";
  switch (m.pattern) {
    case "sustained":
      return `Sustained ${word}${since}: ${level}; it started more than 8 weeks ago.`;
    case "new-deepening":
      return `New ${word}${since}, deepening: ${level}.`;
    case "new":
      return `New ${word}${since}: ${level}.`;
    case "recovering":
      return `Recovering from a ${word}: ${level}, better than the 4 weeks before.`;
    case "recovered":
      return `Back to the usual pace after a ${word} 5–16 weeks ago: ${level}.`;
    case "blip":
      return `One-week ${word}, watching: ${level}.`;
    default:
      return m.status === "normal" ? `Steady: ${level}.` : `Mixed signals: ${level}.`;
  }
}

export type DriverInput = { key: string; label: string; a4: number; l4: number; a16: number; l16: number };
export type Driver = DriverInput & { gap: number; pct4: number | null; pct16: number | null; tag: "sustained" | "new" };

/**
 * The entities (states, reps) behind the company's 4-week change. Each entity's "usual" for the window = its revenue
 * on the same days last year × the company's (expected ÷ last-year) holiday adjustment × (1 + usual growth), so the
 * gaps add up to the company's gap vs usual. Tagged sustained when the 16-week change agrees, else new.
 */
export function drivers(
  rows: DriverInput[],
  co: { a4: number; l4: number; e4: number; a16: number; l16: number; e16: number },
  usual: number,
  direction: Sign,
  top = 3,
): Driver[] {
  const f4 = co.l4 > 0 ? (co.e4 / co.l4) * (1 + usual) : 0;
  const f16 = co.l16 > 0 ? (co.e16 / co.l16) * (1 + usual) : 0; // e = company expected, so Σ gaps = company gap
  const out = rows.map(r => {
    const u4 = r.l4 * f4;
    const u16 = r.l16 * f16;
    const pct4 = u4 > 0 ? r.a4 / u4 - 1 : null;
    const pct16 = u16 > 0 ? r.a16 / u16 - 1 : null;
    const tag: Driver["tag"] =
      pct4 !== null && pct16 !== null && sign(pct4) === sign(pct16) && Math.abs(pct16) >= 0.5 * Math.abs(pct4) ? "sustained" : "new";
    return { ...r, gap: r.a4 - u4, pct4, pct16, tag };
  });
  const key = direction < 0 ? (d: Driver) => d.gap : direction > 0 ? (d: Driver) => -d.gap : (d: Driver) => -Math.abs(d.gap);
  return out.sort((a, b) => key(a) - key(b)).slice(0, top);
}
