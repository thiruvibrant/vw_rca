/**
 * Who is on the Call-first list: ordered 5+ days ago and not yet churned by the clinic's OWN threshold (45 days, or 3 x its usual gap for a
 * slow buyer), so a slow-rhythm clinic stays on past day 45 (2026-10-19). The chip counts use the same test, so a chip's number is the length
 * of the list it opens. This is not the At-risk definition (analytics/atRisk.ts): Call-first is everyone worth a call, at-risk is late and short.
 */
export const CALL_FIRST_MIN_DAYS = 5;
export function inCallFirstWindow(daysSinceLast: number | null, churned: boolean): boolean {
  return daysSinceLast !== null && daysSinceLast >= CALL_FIRST_MIN_DAYS && !churned;
}
