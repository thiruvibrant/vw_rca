/**
 * New product launches, judged fairly (2026-11-24). Pure functions, shared by the snapshot step (launchTracker.ts) and the offline
 * checks (scripts/launch-tracker.test.ts).
 *
 * A launch has no history to set a baseline from, and it can land in a holiday week, so it is not judged on its own volume:
 *  - Aligned by launch age: week 1 = the first 7 days from the launch date; only complete weeks are scored.
 *  - Season-free: attach rate = the family's orders per 100 company orders that week. Company volume absorbs the holiday, so the dip
 *    cancels. Weeks holding a big holiday (factor < 0.5 in analytics/holidays.csv) are marked and not scored, for the launch and for
 *    the references.
 *  - Reference class, as a range: the attach rate of earlier launches at the same age (p25 / median / p75), never a single target.
 *  - Goal is a leadership decision; the band is the data's expectation.
 * Orders are the dashboard's own family orders (the Product family tiles), not BigQuery samples.
 */
import { addDays, diffDays } from "./dateUtils";
import { HOLIDAYS } from "./goalCurve";

export type Day = { d: string; o: number; r: number };
export type LaunchKind = "launch" | "relaunch";
export type LaunchDef = {
  family: string;
  parent: string;
  /** Official launch date from leadership; absent = worked out from the orders. Orders dated earlier (a system issue put a few in) are ignored. */
  date?: string;
  /** relaunch: an existing product changed (e.g. markers added). It keeps its own history, so it is judged against its own range before `date`, not against earlier launches. */
  kind?: LaunchKind;
};

/** The Baselines being tracked, with the Zoomer each one is a lighter version of. Leadership dates go in `date` once confirmed. */
export const LAUNCHES: LaunchDef[] = [
  // Official dates from Thiru, 2026-11-25. Nutrient Baseline first launched Feb 2; "Nutrient Baseline 2.0" (added markers) replaced it on Nov 9.
  { family: "Nutrient Baseline", parent: "Nutrient Zoomer", date: "2026-11-09", kind: "relaunch" },
  { family: "Foundation Baseline", parent: "Foundation Zoomer", date: "2026-09-28" },
  { family: "Gut Baseline", parent: "Gut Zoomer", date: "2026-11-09" }, // one stray order on Sep 17 (system issue) is ignored
  { family: "Hormone Baseline", parent: "Hormone Zoomer", date: "2026-11-09" },
  { family: "Cardio Baseline", parent: "Cardio Zoomer", date: "2026-11-16" },
  { family: "Gut Zoomer NY", parent: "Gut Zoomer", date: "2026-08-24" }, // "Gut Zoomer New York"; a trickle of orders from Jun 2 is ignored
];

/**
 * Official start dates per test version (the raw `test_name`, which keeps version numbers and variants; the product family strips
 * them). They override the date read from the orders (analytics/versionModel.ts). Thiru, 2026-11-25.
 */
export const VERSION_DATES: Record<string, string> = {
  "Nutrient Baseline": "2026-02-02",
  "Nutrient Baseline 2.0": "2026-11-09",
  "Foundation Baseline": "2026-09-28",
  "Gut Baseline": "2026-11-09",
  "Hormone Baseline": "2026-11-09",
  "Cardio Baseline": "2026-11-16",
  "Gut Zoomer New York": "2026-08-24",
};
/** Earlier launches that set the band. A tracked launch is also a reference for the others once it has weeks of its own. */
export const REFERENCES = ["Cardio Zoomer", "Food Zoomer", "Nutrient Baseline", "Foundation Baseline"];

export const MODEL = {
  /** a launch date needs this many orders in its first 7 days (one stray early order is not a launch) */
  startOrders: 3,
  /** a launch is "too early" until it has this many scored weeks (full, not a holiday week: the launch push and the first weeks swing too much) and this many orders */
  earlyScored: 3,
  earlyOrders: 30,
  /** scored weeks in a row above / below the band */
  runWeeks: 2,
  /** references needed at an age before a band is drawn (a holiday week drops a reference at that age, and there are few launches) */
  minRefs: 2,
  /** past this many days a product is no longer a launch: judged like any other family */
  matureDays: 98,
  /** a week with a holiday day at or below this factor is not scored */
  holidayFactor: 0.5,
  /** rising / falling when the last 2 scored weeks' attach rate vs the 2 before is beyond this ratio */
  trend: 1.15,
};

/** First date whose own day has an order and whose first 7 days hold at least `startOrders` orders. */
export function launchDateOf(days: readonly Day[], minOrders = MODEL.startOrders): string | null {
  const by = new Map(days.map(x => [x.d, x.o]));
  const ds = [...by.keys()].filter(d => (by.get(d) ?? 0) > 0).sort();
  for (const d of ds) {
    let n = 0;
    for (let k = 0; k < 7; k++) n += by.get(addDays(d, k)) ?? 0;
    if (n >= minOrders) return d;
  }
  return null;
}

/** A week holding a day with a big holiday effect (Thanksgiving, Christmas, New Year's Eve, ...), weekend or not. */
export function holidayWeek(start: string): boolean {
  for (let k = 0; k < 7; k++) {
    const h = HOLIDAYS.get(addDays(start, k));
    if (h && h.factor < MODEL.holidayFactor) return true;
  }
  return false;
}

export type Week = {
  n: number;
  start: string;
  end: string;
  complete: boolean;
  holiday: boolean;
  orders: number;
  revenue: number;
  company: number;
  /** orders per 100 company orders */
  attach: number;
};

/** Weekly buckets from the launch date to `asOf`. `company` = company orders by day. */
export function launchWeeks(days: readonly Day[], company: ReadonlyMap<string, number>, launch: string, asOf: string): Week[] {
  const by = new Map(days.map(x => [x.d, x]));
  const out: Week[] = [];
  for (let n = 1; ; n++) {
    const start = addDays(launch, 7 * (n - 1));
    if (start > asOf) break;
    const end = addDays(start, 6);
    let o = 0, r = 0, c = 0;
    for (let k = 0; k < 7; k++) {
      const d = addDays(start, k);
      if (d > asOf) break;
      o += by.get(d)?.o ?? 0;
      r += by.get(d)?.r ?? 0;
      c += company.get(d) ?? 0;
    }
    out.push({ n, start, end, complete: end <= asOf, holiday: holidayWeek(start), orders: o, revenue: r, company: c, attach: c > 0 ? (o / c) * 100 : 0 });
  }
  return out;
}

/** Linear-interpolated percentile of a sorted copy. */
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export type Band = { n: number; p25: number; median: number; p75: number; refs: number };

/** The band at each launch age from the references' scored weeks (complete, not a holiday week). `null` where under `minRefs` references. */
export function referenceBand(refs: ReadonlyArray<ReadonlyArray<Week>>, maxWeek: number): Array<Band | null> {
  const out: Array<Band | null> = [];
  for (let n = 1; n <= maxWeek; n++) {
    const xs = refs.map(w => w.find(x => x.n === n)).filter((x): x is Week => !!x && x.complete && !x.holiday).map(x => x.attach);
    out.push(xs.length >= MODEL.minRefs ? { n, p25: percentile(xs, 0.25), median: percentile(xs, 0.5), p75: percentile(xs, 0.75), refs: xs.length } : null);
  }
  return out;
}

export type Status = "too-early" | "ahead" | "on-track" | "behind" | "no-band" | "mature";
export type Trend = "rising" | "steady" | "falling" | null;

/** Scored weeks = complete, not a holiday week. */
export const scoredWeeks = (w: readonly Week[]) => w.filter(x => x.complete && !x.holiday);

export function statusOf(weeks: readonly Week[], band: ReadonlyArray<Band | null>, asOf: string, launch: string): Status {
  const days = diffDays(launch, asOf) + 1;
  if (days > MODEL.matureDays) return "mature";
  const orders = weeks.reduce((t, w) => t + w.orders, 0);
  const scored = scoredWeeks(weeks);
  if (scored.length < MODEL.earlyScored || orders < MODEL.earlyOrders) return "too-early";
  const last = scored.slice(-MODEL.runWeeks);
  const bands = last.map(w => band[w.n - 1] ?? null);
  if (bands.some(b => !b)) return "no-band";
  if (last.every((w, i) => w.attach > bands[i]!.p75)) return "ahead";
  if (last.every((w, i) => w.attach < bands[i]!.p25)) return "behind";
  return "on-track";
}

/** Attach rate of the last 2 scored weeks vs the 2 before (season-free). Null under 4 scored weeks. */
export function trendOf(weeks: readonly Week[]): { ratio: number; trend: Trend } | null {
  const s = scoredWeeks(weeks);
  if (s.length < 4) return null;
  const avg = (xs: readonly Week[]) => xs.reduce((t, w) => t + w.attach, 0) / xs.length;
  const now = avg(s.slice(-2)), before = avg(s.slice(-4, -2));
  if (!(before > 0)) return null;
  const ratio = now / before;
  return { ratio, trend: ratio >= MODEL.trend ? "rising" : ratio <= 1 / MODEL.trend ? "falling" : "steady" };
}

/**
 * Dollars (the dashboard's family revenue, split pro rata across the families in an order): revenue so far, the recent weekly run rate
 * (last 2 scored weeks), and what the reference median attach rate at launch age 8-13 would bring a week at today's normal company
 * volume. `upside` = potential minus run rate, never negative: the room to grow. Null `potential` when there is no band to read.
 */
export function dollarsOf(weeks: readonly Week[], band: ReadonlyArray<Band | null>, normalCompanyWeek: number) {
  const revenue = weeks.reduce((t, w) => t + w.revenue, 0);
  const orders = weeks.reduce((t, w) => t + w.orders, 0);
  const last = scoredWeeks(weeks).slice(-2);
  const runRate = last.length ? last.reduce((t, w) => t + w.revenue, 0) / last.length : null;
  const perOrder = orders > 0 ? revenue / orders : 0;
  const meds = band.slice(7, 13).filter((b): b is Band => !!b).map(b => b.median);
  const potentialOrders = meds.length ? (meds.reduce((t, x) => t + x, 0) / meds.length / 100) * normalCompanyWeek : null;
  const potential = potentialOrders !== null ? potentialOrders * perOrder : null;
  return { revenue, runRate, perOrder, potential, upside: potential !== null ? Math.max(0, potential - (runRate ?? 0)) : null };
}

/** Median company orders per week over the last `weeks` complete weeks that are not holiday weeks (today's normal volume). */
export function normalCompanyWeek(company: ReadonlyMap<string, number>, asOf: string, weeks = 8): number {
  const out: number[] = [];
  // Walk back from the last complete Mon-Sun week.
  let end = asOf;
  while (new Date(end + "T00:00:00Z").getUTCDay() !== 0) end = addDays(end, -1);
  for (let k = 0; out.length < weeks && k < 30; k++) {
    const e = addDays(end, -7 * k), s = addDays(e, -6);
    if (holidayWeek(s)) continue;
    let t = 0;
    for (let i = 0; i < 7; i++) t += company.get(addDays(s, i)) ?? 0;
    if (t > 0) out.push(t);
  }
  return out.length ? percentile(out, 0.5) : 0;
}

/**
 * A relaunch (an existing product changed) already has history, so it gets a baseline of its own: the range of its attach rate over its
 * last `weeks` scored weeks before the relaunch (needs `minWeeks`). `before` = weeks from its first launch up to the day before the relaunch.
 */
export function ownBand(before: readonly Week[], weeks = 13, minWeeks = 6): { p25: number; median: number; p75: number; weeks: number } | null {
  const xs = scoredWeeks(before).slice(-weeks).map(w => w.attach);
  if (xs.length < minWeeks) return null;
  return { p25: percentile(xs, 0.25), median: percentile(xs, 0.5), p75: percentile(xs, 0.75), weeks: xs.length };
}

/** The same own range at every launch age, so statusOf and dollarsOf can read it like a reference band. */
export const flatBand = (b: { p25: number; median: number; p75: number } | null, maxWeek: number): Array<Band | null> =>
  Array.from({ length: maxWeek }, (_, i) => (b ? { n: i + 1, p25: b.p25, median: b.median, p75: b.p75, refs: 0 } : null));
