/**
 * Baseline window, baseline day weights and the daily goal: METRIC_DEFINITIONS.md, Appendix A (A1–A11).
 * The executive emails (Sales Ad hoc/_shared/exec_core) implement the same rules; keep the two in step.
 *
 * Pure functions on plain maps so the rebuild and the offline test (scripts/baseline-goal.test.ts) share them.
 */
import { addDays, dow, eachDay } from "./dateUtils";
import { HOLIDAYS_CSV } from "./holidaysData";

export type Holiday = { date: string; name: string; cls: string; factor: number };

export const HOLIDAYS: ReadonlyMap<string, Holiday> = new Map(
  HOLIDAYS_CSV.trim()
    .split("\n")
    .slice(1)
    .map(line => {
      const [date, name, cls, factor] = line.split(",");
      return [date, { date, name, cls, factor: Number(factor) }] as const;
    }),
);

/** A1: a listed date that falls Monday–Friday (any class). */
export function isWeekdayHoliday(d: string): boolean {
  const k = dow(d);
  return k >= 1 && k <= 5 && HOLIDAYS.has(d);
}

/** This year's calendar effect for a day: the holiday factor on a weekday holiday, otherwise 1. */
export function calendarEffect(d: string): number {
  return isWeekdayHoliday(d) ? (HOLIDAYS.get(d)!.factor) : 1;
}

export const BASELINE_DAYS = 91;
export const OUTLIER_CAP = 2;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** First day of the calendar quarter containing `d`. */
export function quarterStart(d: string): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return `${y}-${String(3 * Math.floor((m - 1) / 3) + 1).padStart(2, "0")}-01`;
}

/** A2: the 12 months before the quarter containing the reference date. */
export function lookbackOf(refDate: string): { start: string; end: string } {
  const qs = quarterStart(refDate);
  return { start: `${Number(qs.slice(0, 4)) - 1}${qs.slice(4)}`, end: addDays(qs, -1) };
}

/** A3: the 91 consecutive days inside the lookback with the highest company revenue (ties: the latest). */
export function bestWindow(revByDay: ReadonlyMap<string, number>, refDate: string): { start: string; end: string; revenue: number } | null {
  const { start, end } = lookbackOf(refDate);
  const days = eachDay(start, end);
  if (days.length < BASELINE_DAYS) return null;
  let sum = 0;
  let best = -1;
  let bestEnd = "";
  for (let i = 0; i < days.length; i++) {
    sum += revByDay.get(days[i]) ?? 0;
    if (i >= BASELINE_DAYS) sum -= revByDay.get(days[i - BASELINE_DAYS]) ?? 0;
    if (i >= BASELINE_DAYS - 1 && sum >= best) {
      best = sum;
      bestEnd = days[i];
    }
  }
  return best > 0 ? { start: addDays(bestEnd, -(BASELINE_DAYS - 1)), end: bestEnd, revenue: best } : null;
}

export type BaselineDays = {
  /** weight per window day (A4): 0 for weekday holidays, below 1 for capped outlier days, else 1 */
  weight: Record<string, number>;
  /** A5: window days per weekday (Sun..Sat) that count (weight > 0) */
  counts: number[];
  medians: number[];
  excluded: string[];
  capped: string[];
};

/** A4–A5: day weights and day counts for the baseline window, from the company's daily revenue. */
export function baselineDays(revByDay: ReadonlyMap<string, number>, start: string, end: string): BaselineDays {
  const days = eachDay(start, end);
  const byDow: number[][] = [[], [], [], [], [], [], []];
  for (const d of days) if (!isWeekdayHoliday(d)) byDow[dow(d)].push(revByDay.get(d) ?? 0);
  const medians = byDow.map(median);
  const weight: Record<string, number> = {};
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const excluded: string[] = [];
  const capped: string[] = [];
  for (const d of days) {
    if (isWeekdayHoliday(d)) {
      weight[d] = 0;
      excluded.push(d);
      continue;
    }
    const rev = revByDay.get(d) ?? 0;
    const cap = OUTLIER_CAP * medians[dow(d)];
    const w = rev > cap && rev > 0 ? cap / rev : 1;
    if (w < 1) capped.push(d);
    weight[d] = w;
    if (w > 0) counts[dow(d)]++; // A5: only days that count
  }
  return { weight, counts, medians, excluded, capped };
}

/** Weight of a day for baseline sums: 1 outside the stored weights (a day outside the window never reaches a baseline sum). */
export function dayWeight(bd: Pick<BaselineDays, "weight"> | null | undefined, d: string): number {
  return bd?.weight[d] ?? 1;
}

/**
 * A10: each day's share-of-year weight, W(d) = Normal(d) x calendar effect. Normal = median of last year's revenue on
 * the first four non-holiday days among ly±7, ±14, ±21, ±28 (nearest first), where ly = d − 364.
 */
export function goalWeights(lyRevByDay: ReadonlyMap<string, number>, year: number): Map<string, number> {
  const out = new Map<string, number>();
  // Only days before the goal year: the year's goal is fixed on Jan 1 and never moves as January data arrives.
  for (const d of eachDay(`${year}-01-01`, `${year}-12-31`)) out.set(d, normalLevel(lyRevByDay, d, `${year}-01-01`) * calendarEffect(d));
  return out;
}

/**
 * A10 Normal(d): the median revenue of the first `take` non-holiday days among ly±7, ±14, … ±7·reach (nearest first),
 * ly = d − 364, using only days before `before` that are in `revByDay`. 0 when none are found.
 * The goal uses A10's 4 of ±4 weeks. The momentum tile (analytics/momentum.ts) uses 12 of ±6 weeks: the same rule,
 * smoothed more, so one unusual week last year doesn't make several weeks this year look off.
 */
export function normalLevel(revByDay: ReadonlyMap<string, number>, d: string, before?: string, take = 4, reach = 4): number {
  const ly = addDays(d, -364);
  const near: number[] = [];
  for (let k = 1; k <= reach && near.length < take; k++) {
    for (const x of [addDays(ly, -7 * k), addDays(ly, 7 * k)]) {
      if (near.length < take && (!before || x < before) && !isWeekdayHoliday(x) && revByDay.has(x)) near.push(revByDay.get(x)!);
    }
  }
  return median(near);
}

/** Share of the year's existing-business goal falling on the given days (A11, Existing). Days outside the year add 0. */
export function curveShareOver(weights: ReadonlyMap<string, number>, days: readonly string[]): number {
  let total = 0;
  for (const w of weights.values()) total += w;
  if (total <= 0) return 0;
  let s = 0;
  for (const d of days) s += weights.get(d) ?? 0;
  return s / total;
}

/** A11: the company's daily goal split into existing and new business. */
export function dailyGoal(args: {
  weights: ReadonlyMap<string, number>;
  year: number;
  target: number;
  newSlice: number;
  /** 12 monthly shares of last year's new-clinic revenue */
  newPhasing?: number[];
}): Map<string, { existing: number; newBiz: number }> {
  const { weights, year, target, newSlice, newPhasing } = args;
  let total = 0;
  for (const w of weights.values()) total += w;
  const out = new Map<string, { existing: number; newBiz: number }>();
  const yearDays = eachDay(`${year}-01-01`, `${year}-12-31`);
  for (const d of yearDays) {
    const m = Number(d.slice(5, 7));
    const dim = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const share = newPhasing && newPhasing.length === 12 ? newPhasing[m - 1] / dim : 1 / yearDays.length;
    out.set(d, {
      existing: total > 0 ? ((target - newSlice) * (weights.get(d) ?? 0)) / total : 0,
      newBiz: newSlice * share,
    });
  }
  return out;
}
