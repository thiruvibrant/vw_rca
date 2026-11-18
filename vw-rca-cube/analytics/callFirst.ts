/**
 * Who is on the Call-first list: ordered 5+ days ago and not yet churned by the clinic's OWN threshold (45 days, or 3 x its usual gap for a
 * slow buyer), so a slow-rhythm clinic stays on past day 45 (2026-10-19). The chip counts use the same test, so a chip's number is the length
 * of the list it opens. This is not the At-risk definition (analytics/atRisk.ts): Call-first is everyone worth a call, at-risk is late and short.
 */
export const CALL_FIRST_MIN_DAYS = 5;
export function inCallFirstWindow(daysSinceLast: number | null, churned: boolean): boolean {
  return daysSinceLast !== null && daysSinceLast >= CALL_FIRST_MIN_DAYS && !churned;
}

/** The extra chip on the Call-first list: the clinics on the At-risk card (analytics/atRisk.ts), whatever health flags they carry. */
export const AT_RISK_TAG = "At risk";
export function onCallFirstTag(tag: string, clinic: string, health: readonly string[], atRisk: ReadonlySet<string>): boolean {
  return tag === AT_RISK_TAG ? atRisk.has(clinic) : health.includes(tag);
}
