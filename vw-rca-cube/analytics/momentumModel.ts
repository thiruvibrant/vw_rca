/**
 * Momentum: is the business speeding up or slowing down? METRIC_DEFINITIONS.md §8.
 *
 * Plain statistics, no ML (classical seasonal adjustment + control-chart rules), run separately on revenue and on
 * orders, because a price change moves revenue but not order volume:
 *  - Season: each day's seasonal strength = last year's normal level for that day (goalCurve.normalLevel) × this year's
 *    holiday factor ÷ last year's trend (the 364-day average centred on that day). Dividing by last year's trend
 *    matters: comparing with last year directly would turn last year's growth into a fake slide this year.
 *  - Usual pace = seasonal strength × the level of the half-year before the last 16 weeks.
 *  - Three plain questions: How big? (last 4 weeks vs the normal range) How long? (weeks in a row on one side)
 *    Which way? (last 4 weeks vs the 4 before). Red = outside the range AND 5+ weeks in a row; Amber = one of those.
 *
 * Pure functions on plain maps, shared by the snapshot step (analytics/momentum.ts) and the offline test (scripts/momentum.test.ts).
 */
import { addDays, dow, weekStart } from "./dateUtils";
import { calendarEffect, isWeekdayHoliday, normalLevel } from "./goalCurve";

export const MOMENTUM = {
  /** last year's normal level: median of `normalTake` days among ly ± 7 … ± 7·normalReach (goalCurve.normalLevel) */
  normalTake: 12,
  normalReach: 6,
  /** each business day is capped at this many robust SDs of the daily ratio before the weekly sums (one odd day ≠ a shift) */
  dayCap: 3,
  /** the windows shown: last 1, 4, 8 and 16 complete weeks */
  windows: [1, 4, 8, 16] as const,
  /** noise: weekly noise measured over the 52 complete weeks before the recent 16, from week-to-week changes */
  refWeeks: 52,
  /** allowance for correlation between neighbouring weeks (calibrated by simulation, scripts/momentum.test.ts) */
  bandInflation: 1.25,
  /** usual: the level of the 26 weeks just before the recent 16 ("the half-year before") */
  anchorWeeks: 26,
  /** last year's trend: the average daily value over this many days centred on the day */
  trendDays: 364,
  /** How big: the last 4 weeks are outside the normal range beyond this many noise bands */
  z: 2,
  /** How long: Red needs this many weeks in a row on one side (with the 4 weeks outside the range) */
  redWeeks: 5,
  /** How long: Amber on its own at this many weeks in a row, even inside the range (a slow drift) */
  amberWeeks: 6,
  /** weeks of light history (the coloured strip and "since") */
  historyWeeks: 52,
};
export type MomentumParams = typeof MOMENTUM;

export type Sign = -1 | 0 | 1;
export type Light = "red" | "amber" | "green";
export type Way = "improving" | "worsening" | "steady";

export type PaceWindow = {
  weeks: number;
  start: string;
  end: string;
  actual: number;
  /** usual pace for the same days: season × the half-year-before's level */
  expected: number;
  /** the same days 364 days earlier (raw, for drivers and plain "vs last year") */
  ly: number;
  /** actual ÷ expected − 1 */
  pct: number;
  /** actual ÷ ly − 1 */
  yoy: number;
  /** (pct − usual) ÷ this window's noise band */
  z: number;
};

export type Pace = {
  asOf: string;
  /** last day of the last complete Monday–Sunday week */
  weekEnd: string;
  /** median weekly pct in the half-year before the recent 16 weeks (≈ 0 by construction) */
  usual: number;
  windows: PaceWindow[];
  /** last `historyWeeks` complete weeks, oldest first (pct vs today's usual pace) */
  weekly: { start: string; actual: number; expected: number; pct: number }[];
  /** the unfinished week so far (null on a Sunday) */
  thisWeek: { start: string; end: string; actual: number; expected: number; pct: number } | null;
  /** How big: last 4 weeks vs usual, and the normal range (± this much) */
  size: { pct: number; range: number; outside: boolean };
  /** How long: complete weeks in a row on `side` of usual (counted within the last 16; `capped` when all 16) */
  streak: { weeks: number; capped: boolean };
  /** Which way: last 4 weeks vs the 4 before */
  way: Way;
  /** below (−1) or above (+1) usual over the last 4 weeks */
  side: Sign;
  light: Light;
  /** the last complete week touches Dec 20 – Jan 3: Red is shown as Amber */
  holidaySeason: boolean;
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
 * (2023–25: Dec 22–23 and 29–30 at 0.56–0.77), so a week touching these days can show Amber at most.
 */
export function inHolidaySeason(d: string): boolean {
  const md = d.slice(5);
  return md >= "12-20" || md <= "01-03";
}

const sign = (x: number): Sign => (x > 0 ? 1 : x < 0 ? -1 : 0);
export const pctText = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;
export const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Average daily value over `n` days centred on x (0 when the window isn't fully covered by the data). */
function trendFn(series: ReadonlyMap<string, number>, n: number): (x: string) => number {
  const keys = [...series.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  const cum = new Map<string, number>();
  let run = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    run += series.get(d) ?? 0;
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

/** Seasonal strength per day, cached per series (light history re-reads the same days ~52 times). */
const strengthCache = new WeakMap<ReadonlyMap<string, number>, { key: string; trend: (x: string) => number; byDay: Map<string, number> }>();
function strengthOf(series: ReadonlyMap<string, number>, d: string, p: MomentumParams): number {
  const key = `${p.normalTake}/${p.normalReach}/${p.trendDays}`;
  let c = strengthCache.get(series);
  if (!c || c.key !== key) {
    c = { key, trend: trendFn(series, p.trendDays), byDay: new Map() };
    strengthCache.set(series, c);
  }
  let s = c.byDay.get(d);
  if (s === undefined) {
    const trend = c.trend(addDays(d, -364));
    s = trend > 0 ? (normalLevel(series, d, undefined, p.normalTake, p.normalReach) * calendarEffect(d)) / trend : 0;
    c.byDay.set(d, s);
  }
  return s;
}

type Day = { d: string; actual: number; expected: number; ly: number; biz: boolean };
/** A week's sums. `adj` = actual with each business day capped (what the range and streak use). */
type Week = { start: string; actual: number; adj: number; expected: number; ly: number };

function weekOf(days: Day[], cap: (day: Day) => number): Week {
  return {
    start: days[0].d,
    actual: days.reduce((s, x) => s + x.actual, 0),
    adj: days.reduce((s, x) => s + cap(x), 0),
    expected: days.reduce((s, x) => s + x.expected, 0),
    ly: days.reduce((s, x) => s + x.ly, 0),
  };
}

/** actual ÷ expected − 1 over the weeks; `raw` for display, otherwise the capped actual */
const pctOf = (ws: Week[], raw = false) => {
  const e = ws.reduce((s, w) => s + w.expected, 0);
  return e > 0 ? ws.reduce((s, w) => s + (raw ? w.actual : w.adj), 0) / e - 1 : 0;
};

/**
 * The pace read of one daily series (revenue or orders) for data through `asOf`. Needs about 3.3 years of daily
 * history before `asOf`. Null when there is too little.
 */
export function pace(series: ReadonlyMap<string, number>, asOf: string, p: MomentumParams = MOMENTUM): Pace | null {
  const weekEnd = dow(asOf) === 0 ? asOf : addDays(weekStart(asOf), -1);
  const recentN = Math.max(...p.windows);
  const firstDay = addDays(weekEnd, -7 * (recentN + p.refWeeks) + 1);
  const recentStart = addDays(weekEnd, -7 * recentN + 1);
  const days: Day[] = [];
  for (let d = firstDay; d <= asOf; d = addDays(d, 1)) {
    const k = dow(d);
    days.push({ d, actual: series.get(d) ?? 0, expected: strengthOf(series, d, p), ly: series.get(addDays(d, -364)) ?? 0, biz: k >= 1 && k <= 5 && !isWeekdayHoliday(d) });
  }
  // Usual pace = seasonal strength × the half-year-before's level (value per unit of seasonal strength).
  const anchorStart = addDays(recentStart, -7 * p.anchorWeeks);
  const anchor = days.filter(x => x.d >= anchorStart && x.d < recentStart);
  if (!anchor.length || anchor.some(x => x.expected <= 0)) return null;
  const level = anchor.reduce((s, x) => s + x.actual, 0) / anchor.reduce((s, x) => s + x.expected, 0);
  for (const x of days) x.expected *= level;

  // One unusual day mustn't look like a shift: cap each business day at `dayCap` robust SDs of the daily ratio.
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
  const usual = median(ref.slice(-p.anchorWeeks).map(w => pctOf([w])));

  // Noise: weekly σ from week-to-week changes (trend-proof); an n-week window vs the anchor half-year has
  // σ·√(1/n + 1/anchorWeeks), times an allowance for neighbouring weeks moving together.
  const refPct = ref.map(w => pctOf([w]));
  const sigma = Math.max(robustSd(refPct.slice(1).map((x, i) => x - refPct[i])) / Math.SQRT2, 0.005);
  const bandOf = (n: number) => sigma * Math.sqrt(1 / n + 1 / p.anchorWeeks) * p.bandInflation;

  const windows: PaceWindow[] = p.windows.map(n => {
    const ws = recent.slice(-n);
    const actual = ws.reduce((s, w) => s + w.actual, 0);
    const ly = ws.reduce((s, w) => s + w.ly, 0);
    return {
      weeks: n,
      start: ws[0].start,
      end: weekEnd,
      actual,
      expected: ws.reduce((s, w) => s + w.expected, 0),
      ly,
      pct: pctOf(ws, true),
      yoy: ly > 0 ? actual / ly - 1 : 0,
      z: (pctOf(ws) - usual) / bandOf(n),
    };
  });
  const w4 = windows.find(w => w.weeks === 4)!;

  // How big
  const dev4 = pctOf(recent.slice(-4)) - usual;
  const side: Sign = sign(dev4) || -1;
  const outside = Math.abs(w4.z) >= p.z;
  // How long: complete weeks in a row on the same side of usual
  let streak = 0;
  for (let i = recent.length - 1; i >= 0 && sign(pctOf([recent[i]]) - usual) === side; i--) streak++;
  // Which way: last 4 weeks vs the 4 before
  const change = pctOf(recent.slice(-4)) - pctOf(recent.slice(-8, -4));
  const way: Way = Math.abs(change) < bandOf(4) ? "steady" : change > 0 ? "improving" : "worsening";

  const holidaySeason = [0, 1, 2, 3, 4, 5, 6].some(i => inHolidaySeason(addDays(weekEnd, -i)));
  const raw: Light = outside && streak >= p.redWeeks ? "red" : outside || streak >= p.amberWeeks ? "amber" : "green";
  const light: Light = holidaySeason && raw === "red" ? "amber" : raw;

  return {
    asOf,
    weekEnd,
    usual,
    windows,
    weekly: all.slice(-p.historyWeeks).map(w => ({ start: w.start, actual: w.actual, expected: w.expected, pct: pctOf([w], true) })),
    thisWeek:
      weekEnd === asOf
        ? null
        : (() => {
            const w = weekOf(days.filter(x => x.d > weekEnd), cap);
            return { start: w.start, end: asOf, actual: w.actual, expected: w.expected, pct: pctOf([w], true) };
          })(),
    size: { pct: w4.pct, range: p.z * bandOf(4), outside },
    streak: { weeks: streak, capped: streak >= recent.length },
    way,
    side,
    light,
    holidaySeason,
  };
}

export type LightWeek = { weekEnd: string; light: Light; side: Sign };

/** The light for each of the last `weeks` complete weeks, each judged with only the data up to that week. Oldest first. */
export function lightHistory(series: ReadonlyMap<string, number>, asOf: string, weeks: number, p: MomentumParams = MOMENTUM): LightWeek[] {
  const out: LightWeek[] = [];
  const end = dow(asOf) === 0 ? asOf : addDays(weekStart(asOf), -1);
  for (let i = weeks - 1; i >= 0; i--) {
    const we = addDays(end, -7 * i);
    const r = pace(series, we, p);
    if (r) out.push({ weekEnd: we, light: r.light, side: r.side });
  }
  return out;
}

/** First week (Monday) of the current run of non-green weeks on the same side; null when the latest week is green. */
export function sinceOf(history: LightWeek[]): string | null {
  const last = history[history.length - 1];
  if (!last || last.light === "green") return null;
  let i = history.length - 1;
  while (i > 0 && history[i - 1].light !== "green" && history[i - 1].side === last.side) i--;
  return addDays(history[i].weekEnd, -6);
}

/** Average order value over windows: revenue ÷ orders now, vs last year, and the last 4 weeks vs the 12 before. */
export function orderValue(rev: Pace, ord: Pace) {
  const r4 = rev.windows.find(w => w.weeks === 4)!;
  const o4 = ord.windows.find(w => w.weeks === 4)!;
  const now = o4.actual > 0 ? r4.actual / o4.actual : 0;
  const ly = o4.ly > 0 ? r4.ly / o4.ly : 0;
  const n = Math.min(rev.weekly.length, ord.weekly.length);
  const rw = rev.weekly.slice(-n);
  const ow = ord.weekly.slice(-n);
  const sum = (xs: { actual: number }[]) => xs.reduce((s, x) => s + x.actual, 0);
  const prevO = sum(ow.slice(-16, -4));
  const prev = prevO > 0 ? sum(rw.slice(-16, -4)) / prevO : 0;
  const change = prev > 0 ? now / prev - 1 : 0;
  return {
    now,
    ly,
    yoy: ly > 0 ? now / ly - 1 : 0,
    /** last 4 weeks vs the 12 weeks before */
    change,
    way: (Math.abs(change) < 0.03 ? "steady" : change > 0 ? "up" : "down") as "steady" | "up" | "down",
    weekly: rw.map((w, i) => ({ start: w.start, value: ow[i].actual > 0 ? w.actual / ow[i].actual : 0 })),
  };
}

const word = (x: Pace) => (x.side < 0 ? "below" : "above");
const amount = (x: Pace) => `${Math.abs(x.size.pct * 100).toFixed(1)}%`;
const month = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

/**
 * Two or three short sentences in sales and executive language: where revenue and orders stand against normal for this
 * time of year, which one explains the other, and whether price is masking volume.
 */
export function summaryOf(rev: Pace, ord: Pace, aov: ReturnType<typeof orderValue>, ordSince: string | null): string {
  const revOff = rev.light !== "green";
  const ordOff = ord.light !== "green";
  if (!revOff && !ordOff) return "Revenue and orders are at their normal level for this time of year.";
  const since = ordSince ? `, and have been since ${month(ordSince)}` : "";
  const revText = revOff ? `Revenue is ${amount(rev)} ${word(rev)} normal over the last 4 weeks.` : "Revenue is at its normal level.";
  const ordText = ordOff ? `orders are ${amount(ord)} ${word(ord)} normal${since}.` : "orders are at their normal level.";
  const priceUp = aov.yoy > 0.03;
  if (revOff && ordOff && ord.side === rev.side && Math.abs(ord.size.pct) >= Math.abs(rev.size.pct)) {
    const cover = rev.side < 0 && priceUp ? " Higher prices are covering part of the drop." : "";
    return `${revText} The main cause is ${rev.side < 0 ? "fewer" : "more"} orders: ${ordText}${cover}`;
  }
  if (revOff && !ordOff) return `${revText} Orders are normal, so the change is in what customers spend per order.`;
  if (!revOff && ordOff && ord.side < 0 && priceUp) return `${revText} But ${ordText} Higher prices are hiding the drop in orders.`;
  return `${revText} ${ordText.charAt(0).toUpperCase()}${ordText.slice(1)}`;
}

export type DriverInput = { key: string; label: string; a4: number; l4: number; a16: number; l16: number };
export type Driver = DriverInput & { gap: number; pct4: number | null; pct16: number | null; tag: "ongoing" | "new" };

/**
 * The entities (states, reps) behind the company's 4-week change. Each entity's usual = its value on the same days
 * last year × the company's (usual ÷ last year) ratio, so the gaps add up to the company's gap vs usual.
 * Tagged ongoing when the 16-week change agrees (same direction, at least half as large), else new.
 */
export function drivers(
  rows: DriverInput[],
  co: { a4: number; l4: number; e4: number; a16: number; l16: number; e16: number },
  direction: Sign,
  top = 3,
): Driver[] {
  const f4 = co.l4 > 0 ? co.e4 / co.l4 : 0;
  const f16 = co.l16 > 0 ? co.e16 / co.l16 : 0;
  const out = rows.map(r => {
    const u4 = r.l4 * f4;
    const u16 = r.l16 * f16;
    const pct4 = u4 > 0 ? r.a4 / u4 - 1 : null;
    const pct16 = u16 > 0 ? r.a16 / u16 - 1 : null;
    const tag: Driver["tag"] =
      pct4 !== null && pct16 !== null && sign(pct4) === sign(pct16) && Math.abs(pct16) >= 0.5 * Math.abs(pct4) ? "ongoing" : "new";
    return { ...r, gap: r.a4 - u4, pct4, pct16, tag };
  });
  const key = direction < 0 ? (d: Driver) => d.gap : direction > 0 ? (d: Driver) => -d.gap : (d: Driver) => -Math.abs(d.gap);
  return out.sort((a, b) => key(a) - key(b)).slice(0, top);
}
