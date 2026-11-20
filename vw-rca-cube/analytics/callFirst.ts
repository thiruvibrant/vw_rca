/**
 * Who is on the Call-first list: ordered 5+ days ago and not yet churned by the clinic's OWN threshold (45 days, or 3 x its usual gap for a
 * slow buyer), so a slow-rhythm clinic stays on past day 45 (2026-10-19). The chip counts use the same test, so a chip's number is the length
 * of the list it opens. This is not the At-risk definition (analytics/atRisk.ts): Call-first is everyone worth a call, at-risk is late and short.
 */
export const CALL_FIRST_MIN_DAYS = 5;
export function inCallFirstWindow(daysSinceLast: number | null, churned: boolean): boolean {
  return daysSinceLast !== null && daysSinceLast >= CALL_FIRST_MIN_DAYS && !churned;
}

/**
 * The extra chip on the Call-first list: the clinics on the At-risk card (analytics/atRisk.ts) that are in the scorecard's "Active, top 20%"
 * group as of today (`retained_top20`: active, established clinics on the company's last-12-months Top 20% list, analytics/clinicLabels.ts;
 * the caller passes the label at the data-through date, not a past tab's), whatever health flags they carry.
 * Slow, small buyers would not move revenue, so the chip is a short, valuable call list; the At-risk card itself still counts every at-risk
 * clinic. It uses the scorecard's own group so the tag on a clinic, the card and the chip agree (a rep's own top 20% is a different bar).
 */
export const AT_RISK_TAG = "At risk · top 20%";
export const TOP20_COHORT = "retained_top20";
export function onCallFirstTag(tag: string, clinic: string, health: readonly string[], atRisk: ReadonlySet<string>): boolean {
  return tag === AT_RISK_TAG ? atRisk.has(clinic) : health.includes(tag);
}

/** The at-risk clinics that are in the scorecard's Active top 20% group. */
export function topCohortAtRisk(rows: ReadonlyArray<{ clinic: string; cohort: string; onList?: boolean }>, atRisk: ReadonlySet<string>): Set<string> {
  // A Lapsing clinic is no longer in the retained_top20 cohort (it is late), but one on the company list is still a top clinic: nearly every
  // at-risk top clinic is Lapsing, so without `onList` the chip would be empty.
  return new Set(rows.filter(r => (r.cohort === TOP20_COHORT || (r.cohort === "lapsing" && r.onList)) && atRisk.has(r.clinic)).map(r => r.clinic));
}
