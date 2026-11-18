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
 * The extra chip on the Call-first list: the clinics on the At-risk card (analytics/atRisk.ts) that are among the largest 20% of the active
 * existing clinics, whatever health flags they carry. Slow, small buyers would not move revenue, so the chip is a short, valuable call list;
 * the At-risk card itself still counts every at-risk clinic.
 */
export const AT_RISK_TAG = "At risk · top 20%";
export const AT_RISK_SHARE = 0.2;
export function onCallFirstTag(tag: string, clinic: string, health: readonly string[], atRisk: ReadonlySet<string>): boolean {
  return tag === AT_RISK_TAG ? atRisk.has(clinic) : health.includes(tag);
}

/** At-risk clinics whose baseline reaches the top `share` of the active existing clinics' baselines (ties included). */
export function largestAtRisk(
  active: ReadonlyArray<{ clinic: string; baseline: number }>,
  atRisk: ReadonlySet<string>,
  share: number = AT_RISK_SHARE,
): Set<string> {
  const sorted = active.map(a => a.baseline).filter(b => b > 0).sort((a, b) => b - a);
  if (!sorted.length) return new Set();
  const cut = sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)];
  return new Set(active.filter(a => atRisk.has(a.clinic) && a.baseline > 0 && a.baseline >= cut).map(a => a.clinic));
}
