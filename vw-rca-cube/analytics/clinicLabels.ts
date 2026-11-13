/**
 * Clinic labels per window (proposal "One definition of Top 20% clinics", 2026-11-13). Pure functions: the rebuild
 * (refresh.ts) stores a label per clinic per month-end, the clinic list (clinics.ts drill) picks the one for the window
 * on screen and compares it with the window before.
 *
 *  Top 20% list  For month M: every clinic with revenue in the 12 complete months before M, ranked by that revenue
 *                (ties by clinic id); the top 20% by count, rounded up. Fixed for the whole month, so it is the same in
 *                every window, for every rep, and it has no January reset.
 *  Label         Lifecycle first (analytics/lifecycleRules.ts, as of the window's end): churned, reactivated, new; an
 *                active established clinic is retained_top20 when it is on the list in force that month, else retained_rest.
 *  Move          The label in this window vs the window before of the same kind (month vs month, quarter vs quarter;
 *                week and day windows use their month). Up: rest -> top 20%, churned -> reactivated. Down: top 20% -> rest,
 *                anything -> churned. Other changes (new -> established, reactivated -> active) are neutral.
 */
import { addDays, monthEnd, monthsBackStart, quarterKey } from "./dateUtils";
import { classifyClinic } from "./lifecycleRules";

export type Label = "retained_top20" | "retained_rest" | "new" | "reactivated" | "churned";
export type Move = "up" | "down" | "neutral";

/** Short codes for storage (one per clinic per month-end). */
const CODE: Record<Label, string> = { retained_top20: "t", retained_rest: "r", new: "n", reactivated: "a", churned: "c" };
const DECODE: Record<string, Label> = { t: "retained_top20", r: "retained_rest", n: "new", a: "reactivated", c: "churned" };
export const encodeLabel = (l: Label) => CODE[l];
export const decodeLabel = (c: string | undefined): Label | undefined => (c ? DECODE[c] : undefined);

export const TOP_SHARE = 0.2;

export type TierList = {
  /** "YYYY-MM": the month the list is in force */
  month: string;
  top: Set<string>;
  /** 1 = largest */
  rank: Map<string, number>;
  /** revenue in the 12 months before `month` */
  t12: Map<string, number>;
  /** clinics with revenue in those 12 months */
  count: number;
  /** the smallest 12-month revenue still on the list */
  line: number;
};

const monthOf = (d: string) => d.slice(0, 7);
/** "YYYY-MM" -> the month `back` months earlier. */
export const monthBack = (m: string, back: number) => monthOf(monthsBackStart(`${m}-01`, back));

/** The months whose revenue the lists for `listMonths` need (12 before each). */
export function revenueMonthsFor(listMonths: string[]): string[] {
  const out = new Set<string>();
  for (const m of listMonths) for (let k = 1; k <= 12; k++) out.add(monthBack(m, k));
  return [...out].sort();
}

/** One list per month in `listMonths`, from revenue by month ("YYYY-MM") and clinic. */
export function tierLists(monthRev: Map<string, Map<string, number>>, listMonths: string[]): Map<string, TierList> {
  const out = new Map<string, TierList>();
  for (const month of listMonths) {
    const t12 = new Map<string, number>();
    for (let k = 1; k <= 12; k++) {
      for (const [clinic, rev] of monthRev.get(monthBack(month, k)) ?? []) t12.set(clinic, (t12.get(clinic) ?? 0) + rev);
    }
    const ranked = [...t12].filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]) || (a[0] < b[0] ? -1 : 1));
    const n = Math.ceil(ranked.length * TOP_SHARE);
    const rank = new Map<string, number>();
    ranked.forEach(([c], i) => rank.set(c, i + 1));
    out.set(month, {
      month,
      top: new Set(ranked.slice(0, n).map(([c]) => c)),
      rank,
      t12,
      count: ranked.length,
      line: n ? ranked[n - 1][1] : 0,
    });
  }
  return out;
}

/** Lifecycle + list membership -> one label. */
export function labelOf(lc: { isNew: boolean; life: string }, onList: boolean): Label {
  if (lc.life === "churned") return "churned";
  if (lc.life === "reactivated") return "reactivated";
  if (lc.isNew) return "new";
  return onList ? "retained_top20" : "retained_rest";
}

/**
 * The dates a label is stored for: every month-end from three months before the window's first month (so the first
 * month and quarter have a "before"), or from 12 months before its end if that is earlier (the clinic card's history),
 * up to the window's end, plus the window's end itself.
 */
export function labelDates(currentStart: string, currentEnd: string): string[] {
  const out: string[] = [];
  const a = monthBack(monthOf(currentStart), 3), b = monthBack(monthOf(currentEnd), 12);
  for (let m = a < b ? a : b; m <= monthOf(currentEnd); m = monthBack(m, -1)) {
    const end = monthEnd(`${m}-01`);
    if (end < currentEnd) out.push(end);
  }
  out.push(currentEnd);
  return out;
}

/** The month whose list is in force on a label date. */
export const listMonthOf = (date: string) => monthOf(date);

/** Label per date for one clinic. Dates before its first order get none. */
export function labelsFor(
  inp: {
    firstOrder: string;
    orderDates: readonly string[];
    hasBaselineRevenue: boolean;
    hasWindowRevenue: boolean;
    priorRevenue: number;
    clinic: string;
  },
  dates: string[],
  lists: Map<string, TierList>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const date of dates) {
    if (!inp.firstOrder || inp.firstOrder > date) continue;
    const lc = classifyClinic({ ...inp, cutoff: date });
    const onList = lists.get(listMonthOf(date))?.top.has(inp.clinic) ?? false;
    out[date] = encodeLabel(labelOf(lc, onList));
  }
  return out;
}

const quarterStart = (d: string) => {
  const [y, q] = quarterKey(d).split("-Q").map(Number);
  return `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
};
const quarterEnd = (d: string) => monthEnd(monthsBackStart(quarterStart(d), -2));

/**
 * The label date for a window and for the window before it. `all` has no "before". Month and quarter compare with the
 * previous month / quarter; week and day windows use the month they end in.
 */
export function windowDates(periodId: string, periodEnd: string, currentEnd: string): { at: string; before: string | null } {
  const cap = (d: string) => (d < currentEnd ? d : currentEnd);
  if (periodId === "all") return { at: currentEnd, before: null };
  if (periodId.startsWith("q:")) {
    return { at: cap(quarterEnd(periodEnd)), before: addDays(quarterStart(periodEnd), -1) };
  }
  const at = cap(monthEnd(periodEnd));
  return { at, before: addDays(`${monthOf(periodEnd)}-01`, -1) };
}

/** Direction of a label change. Null when either side is missing or nothing changed. */
export function moveOf(before: Label | undefined, now: Label | undefined): Move | null {
  if (!before || !now || before === now) return null;
  if (now === "churned") return "down";
  if (before === "churned") return "up"; // back from churned (reactivated, or a new clinic ordering again)
  if (before === "retained_top20" && now === "retained_rest") return "down";
  if (before === "retained_rest" && now === "retained_top20") return "up";
  return "neutral"; // e.g. new -> established, reactivated -> active
}
