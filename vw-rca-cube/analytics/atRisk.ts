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
  /** ... and past its own 90th-percentile gap, when known, but never asking for more than this many median gaps (two missed intervals), so an old lapse cannot push "late" past the churn line. */
  maxLateRatio: 2,
  /** A real shortfall: at least this share of the baseline, over the whole analysis window. */
  minShortfall: 0.1,
} as const;

/** Flags that count. Ghosted VIP does not: it is a no-contact problem, covered by the Growth page's untouched high-value row. */
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

export function isAtRisk(i: AtRiskInput): boolean {
  const d = i.daysSinceLast;
  if (d === null || d < AT_RISK.minDays) return false;
  if (i.life === "churned") return false;
  if (i.life === undefined && d >= AT_RISK.fixedMaxDays) return false;
  if (!(i.baseline > 0) || -i.realChange < AT_RISK.minShortfall * i.baseline) return false;
  if (!i.health.some(h => FLAGS.test(h))) return false;
  if (i.medianGapBd === undefined || i.bdSinceLastOrder === undefined) return d < AT_RISK.fixedMaxDays;
  const gap = Math.max(i.medianGapBd, 2);
  return i.bdSinceLastOrder > Math.min(Math.max(AT_RISK.lateRatio * gap, i.p90GapBd ?? 0), AT_RISK.maxLateRatio * gap);
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
