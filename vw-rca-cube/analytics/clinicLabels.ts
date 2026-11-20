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
import { addDays, diffDays, monthEnd, monthsBackStart, quarterKey } from "./dateUtils";
import { AT_RISK, isLateByRhythm } from "./atRisk";
import { buyingGapP90, buyingRhythm } from "./flags";
import { classifyClinic } from "./lifecycleRules";

export type Label = "retained_top20" | "retained_rest" | "lapsing" | "new" | "reactivated" | "churned";
export type Move = "up" | "down" | "neutral";

/**
 * Short codes for storage (one per clinic per month-end). Upper case = the clinic is on that month's Top 20% list, whatever
 * its lifecycle (a churned or new clinic can be on it: the list is by revenue, the label by lifecycle). Snapshots built
 * before 2026-11-16 are all lower case; there only "t" says the clinic is on the list.
 */
const CODE: Record<Label, string> = { retained_top20: "t", retained_rest: "r", lapsing: "l", new: "n", reactivated: "a", churned: "c" };
const DECODE: Record<string, Label> = { t: "retained_top20", r: "retained_rest", l: "lapsing", n: "new", a: "reactivated", c: "churned" };
export const encodeLabel = (l: Label, onList = l === "retained_top20") => (onList ? CODE[l].toUpperCase() : CODE[l]);
export const decodeLabel = (c: string | undefined): Label | undefined => (c ? DECODE[c.toLowerCase()] : undefined);
/** Whether a stored code says the clinic is on that month's Top 20% list. */
export const onListOf = (c: string | undefined): boolean => !!c && (c === "t" || c !== c.toLowerCase());

/**
 * A clinic's standing in a window, from its stored codes: on the Top 20% list as of the window's end, its label then and
 * in the window before, and the move. `null` when the snapshot has no codes (older build), so callers keep their own flag.
 */
export function standingIn(
  labelAt: Record<string, string> | undefined,
  dates: { at: string; before: string | null },
): { onList: boolean; cohort?: Label; prevCohort?: Label; move: Move | null } | null {
  if (!labelAt || !Object.keys(labelAt).length) return null;
  const now = labelAt[dates.at];
  const cohort = decodeLabel(now);
  const prevCohort = dates.before ? decodeLabel(labelAt[dates.before]) : undefined;
  return { onList: onListOf(now), cohort, prevCohort, move: moveOf(prevCohort, cohort) };
}

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

/**
 * Lapsing (2026-11-20): an active, established clinic that is late against its own order rhythm as of `cutoff`: at least
 * 5 days since the last order and business days since it past the clinic's late line (analytics/atRisk.ts isLateByRhythm).
 * Needs 3+ order dates (a rhythm). It is the At-risk test without the shortfall-against-baseline gate, so At-risk is a subset.
 */
export function lapsingAt(orderDates: readonly string[], cutoff: string): boolean {
  let last = "";
  for (const d of orderDates) if (d && d <= cutoff && d > last) last = d;
  if (!last || diffDays(last, cutoff) < AT_RISK.minDays) return false;
  const r = buyingRhythm(orderDates, cutoff);
  return !!r && isLateByRhythm(r.medianGapBd, buyingGapP90(orderDates, cutoff), r.bdSinceLastOrder);
}

/** Lifecycle + list membership (+ lateness) -> one label. A lapsing clinic leaves Top 20% / Rest; `onList` still marks the list. */
export function labelOf(lc: { isNew: boolean; life: string }, onList: boolean, lapsing = false): Label {
  if (lc.life === "churned") return "churned";
  if (lc.life === "reactivated") return "reactivated";
  if (lc.isNew) return "new";
  if (lapsing) return "lapsing";
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
    const lapsing = lc.life === "active" && !lc.isNew && lapsingAt(inp.orderDates, date);
    out[date] = encodeLabel(labelOf(lc, onList, lapsing), onList);
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

/**
 * Month-ends inside the analysis window, before its end: the label dates that past windows (an earlier month, quarter,
 * week or day) read. The current windows read the window's end, which the refresh's own cohort rows already cover.
 */
export function pastLabelDates(currentStart: string, currentEnd: string): string[] {
  const out: string[] = [];
  for (let d = monthEnd(currentStart); d < currentEnd; d = monthEnd(addDays(d, 1))) out.push(d);
  return out;
}

/**
 * The days a label date's windows cover, so cohort actuals can be grouped by that label: its month, from six days
 * before (a week ending in the month starts up to six days earlier), and the whole quarter when it is a quarter end.
 */
export function labelDateSpan(labelDate: string): { start: string; end: string } {
  const monthStart = addDays(`${monthOf(labelDate)}-01`, -6);
  const qs = quarterStart(labelDate);
  const isQuarterEnd = quarterEnd(labelDate) === labelDate;
  return { start: isQuarterEnd && qs < monthStart ? qs : monthStart, end: labelDate };
}

/** A clinic's label at a date, falling back (no code: first order later, or an older snapshot) to its refresh-time cohort. */
export const labelAtOr = (labelAt: Record<string, string> | undefined, date: string, fallback: string): string =>
  decodeLabel(labelAt?.[date]) ?? fallback;

/**
 * The lifecycle stage implied by a label, for a past window: the Churned badge and the scorecard's churn count then agree
 * with the label shown. Active covers new, top 20% and the rest.
 */
export const lifeOfLabel = (l: Label): "churned" | "reactivated" | "active" =>
  l === "churned" ? "churned" : l === "reactivated" ? "reactivated" : "active";

/**
 * The lifecycle stage to show in a window: the clinic's current status for the current windows, its label then for a past
 * window (so label, Churned badge and churn count agree). Falls back to the current status when no label is stored.
 */
export function lifeIn(labelAt: Record<string, string> | undefined, life: string | undefined, at: string, currentEnd: string): string | undefined {
  if (at === currentEnd) return life;
  const l = decodeLabel(labelAt?.[at]);
  return l ? lifeOfLabel(l) : life;
}

/** The label date of a window from its id alone (callers without the window's days): see windowDates. */
export function labelDateOf(periodId: string, currentEnd: string): string {
  const [kind, key] = periodId.split(":");
  if (periodId === "all" || !key) return currentEnd;
  if (kind === "q") {
    const [y, q] = key.split("-Q").map(Number);
    return windowDates(periodId, `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, currentEnd).at;
  }
  if (kind === "m") return windowDates(periodId, `${key}-01`, currentEnd).at;
  if (kind === "w") {
    const end = addDays(key, 6);
    return windowDates(periodId, end < currentEnd ? end : currentEnd, currentEnd).at;
  }
  return windowDates(periodId, key, currentEnd).at;
}

/**
 * Cohort movement month by month (2026-11-20): for each pair of consecutive label dates, the clinics whose label changed,
 * in four disjoint groups (the ▲/▼ of moveOf, with churn split out):
 *   up    Active - rest -> Active - top 20%          down  Active - top 20% -> Active - rest
 *   back  Churned -> anything else                   churn anything else -> Churned
 * plus clinics with their first label (first order) and a count of clinics that went Churned and were back within the next
 * two label dates (`bounced`: noise from irregular orderers, not real losses). Revenue per clinic is `rev(clinic, month)`:
 * the month before the move for down and churn (what was at stake), the month of the move for up and back (what came back).
 */
export type FlowGroup = "up" | "down" | "back" | "churn";
export type FlowRow = {
  /** label date before and after */
  from: string;
  to: string;
  /** clinics labelled at both dates */
  labelled: number;
  first: number;
  bounced: number;
  groups: Record<FlowGroup, { n: number; rev: number }>;
};

export function flowGroupOf(before: Label | undefined, now: Label | undefined): FlowGroup | null {
  if (!before || !now || before === now) return null;
  if (now === "churned") return "churn";
  if (before === "churned") return "back";
  if (before === "retained_top20" && now === "retained_rest") return "down";
  if (before === "retained_rest" && now === "retained_top20") return "up";
  return null;
}

export function flowsOf(
  clinics: Array<{ clinic: string; labelAt?: Record<string, string> }>,
  dates: string[],
  rev: (clinic: string, month: string) => number = () => 0,
): FlowRow[] {
  const ds = [...dates].sort();
  const out: FlowRow[] = [];
  for (let i = 1; i < ds.length; i++) {
    const from = ds[i - 1], to = ds[i];
    const row: FlowRow = {
      from,
      to,
      labelled: 0,
      first: 0,
      bounced: 0,
      groups: { up: { n: 0, rev: 0 }, down: { n: 0, rev: 0 }, back: { n: 0, rev: 0 }, churn: { n: 0, rev: 0 } },
    };
    for (const c of clinics) {
      const a = decodeLabel(c.labelAt?.[from]), b = decodeLabel(c.labelAt?.[to]);
      if (!b) continue;
      if (!a) {
        row.first++;
        continue;
      }
      row.labelled++;
      const g = flowGroupOf(a, b);
      if (!g) continue;
      const month = monthOf(g === "down" || g === "churn" ? from : to);
      row.groups[g].n++;
      row.groups[g].rev += rev(c.clinic, month);
      if (g === "churn" && ds.slice(i + 1, i + 3).some(d => { const l = decodeLabel(c.labelAt?.[d]); return !!l && l !== "churned"; })) row.bounced++;
    }
    out.push(row);
  }
  return out;
}

/** Direction of a label change. Null when either side is missing or nothing changed. */
export function moveOf(before: Label | undefined, now: Label | undefined): Move | null {
  if (!before || !now || before === now) return null;
  if (now === "churned") return "down";
  if (before === "churned") return "up"; // back from churned (reactivated, or a new clinic ordering again)
  if (before === "retained_top20" && now === "retained_rest") return "down";
  if (before === "retained_rest" && now === "retained_top20") return "up";
  return "neutral"; // e.g. new -> established, reactivated -> active, and to or from Lapsing (a warning, not a move)
}
