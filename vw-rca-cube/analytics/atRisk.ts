/**
 * At-risk customers, judged against the clinic's own order rhythm (design: docs/superpowers/specs/2026-11-17-at-risk-cadence-design.md).
 * One definition for the scorecard, the rep view and the Growth page: they all read `atRiskRows` in repView.ts, which calls `isAtRisk`.
 */
export const AT_RISK = {
  /** Ordered fewer days ago than this: just ordered, not at risk. */
  minDays: 5,
  /** Without a rhythm (under three order dates) or a status, the old fixed window ends here. */
  fixedMaxDays: 45,
  /** Late = business days since the last order past this many times the clinic's median gap (gap floored at 2) ... */
  lateRatio: 1.5,
  /** ... and past its own 90th-percentile gap, when known. "Late" never waits past this share of the way to the clinic's churn line. */
  headroom: 0.8,
  /** The churn line in business days, about max(45 days, 3 x the median gap) (analytics/lifecycleRules.ts): 45 calendar days is about 31. */
  churnFloorBd: 31,
  churnMultiple: 3,
  /** A real shortfall: at least this share of the baseline, over the whole analysis window. */
  minShortfall: 0.1,
} as const;

/** Flags that count for a clinic with no rhythm. Ghosted VIP does not: it is a no-contact problem, covered by the Growth page's untouched high-value row. */
const FLAGS = /slipping|overdue|risk|drop/i;

export type AtRiskInput = {
  /** active / reactivated / churned, by the clinic's own gap threshold. */
  life?: string;
  daysSinceLast: number | null;
  medianGapBd?: number;
  p90GapBd?: number;
  bdSinceLastOrder?: number;
  baseline: number;
  /** actual minus baseline in the window. */
  realChange: number;
  health: readonly string[];
};

/**
 * With a rhythm (3+ order dates) lateness and a real shortfall decide: no flag is needed, because only Bleed flags fire before the churn line
 * for a slow buyer, and a flag gate would hide exactly the clinics that give the most warning. Without a rhythm the old rule applies:
 * the fixed 5 to 44 day window and a slipping, overdue or bleed flag.
 */
export function isAtRisk(i: AtRiskInput): boolean {
  const d = i.daysSinceLast;
  if (d === null || d < AT_RISK.minDays) return false;
  if (i.life === "churned") return false;
  if (i.life === undefined && d >= AT_RISK.fixedMaxDays) return false;
  if (!(i.baseline > 0) || -i.realChange < AT_RISK.minShortfall * i.baseline) return false;
  if (i.medianGapBd === undefined || i.bdSinceLastOrder === undefined) return d < AT_RISK.fixedMaxDays && i.health.some(h => FLAGS.test(h));
  const gap = Math.max(i.medianGapBd, 2);
  const churnBd = Math.max(AT_RISK.churnFloorBd, AT_RISK.churnMultiple * i.medianGapBd);
  const late = Math.min(Math.max(AT_RISK.lateRatio * gap, i.p90GapBd ?? 0), AT_RISK.headroom * churnBd);
  return i.bdSinceLastOrder > late;
}

/** The clinic's flags, baseline and real change over the whole analysis window (the "all" tab's row). */
export type WholeWindow = { health: readonly string[]; baseline: number; realChange: number };

/**
 * `isAtRisk` with the shortfall and flags taken from the whole analysis window, so the same clinics are at risk on every tab
 * (a short tab's own baseline and shortfall swing too much). Without a whole-window row the tab's own numbers are used.
 */
export function isAtRiskInWindow(row: AtRiskInput, whole?: WholeWindow): boolean {
  return isAtRisk({ ...row, baseline: whole?.baseline ?? row.baseline, realChange: whole?.realChange ?? row.realChange, health: whole?.health ?? row.health });
}
