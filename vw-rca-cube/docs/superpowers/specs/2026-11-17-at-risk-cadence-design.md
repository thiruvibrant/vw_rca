# At-risk customers: cadence-aware definition (short design)

Approved in conversation, 17 Nov 2026 ("agree with all 4 points, across all pages").

## Intent
"At-risk customers" counts clinics that are healthy but late, flat or lumpy. It must count only clinics that are really slipping, on every page (scorecard, rep view, Growth page), because they all read one definition: `atRiskRows` in `analytics/repView.ts`.

## The rule (replaces "last order 5-44 days ago and a slipping/overdue/risk/ghost/drop flag")
An existing clinic is at risk when all of these hold:
1. It last ordered 5 or more days ago and has not churned (the clinic's own churn status, `life !== "churned"`; with no status, under 45 days as before).
2. It is late against its own rhythm: business days since its last order are more than 1.5 x its median gap (gap floored at 2) and more than its 90th-percentile gap, capped at two median gaps (a clinic that orders in bursts is allowed longer gaps, but an old lapse cannot push "late" past the churn line). A clinic with under three order dates has no rhythm; for it the old fixed 5-44 day window applies.
3. It is below its baseline by at least 10% of the baseline over the whole analysis window (the "all" row, so the same clinics are at risk on every tab; the dollars still follow the tab).
4. It carries at least one of the existing health flags Slipping Away, Buying Overdue or a Bleed (drop) flag. Ghosted VIP no longer counts: it is a no-contact problem and the Growth page's "Re-engage high-value clinics with no recent call or meeting" row covers it.

## Goals
- One pure function `isAtRisk` with tests; `atRiskRows` uses it; all pages follow without further logic.
- Help text on every page describes the new rule.
- A new optional per-clinic `p90GapBd` is stored beside `medianGapBd` and filled by the next refresh; until then the rule uses 1.5 x median only.

## Non-goals
- No change to the health flags shown on clinic badges, or to churn, or to dollar sizing (shortfall = baseline - actual, annualized).
- No change to the 35% default target on the Growth page.

## Constraints
- Additive schema change only (optional field); needs an engine redeploy and a data refresh.
- The scorecard's At-risk numbers will drop. That is intended; counts before and after should be compared once deployed.

## Approaches considered
1. Pure rule function in its own file, called from `atRiskRows` (chosen): testable without the engine.
2. Edit the filter inline in `repView.ts`: rejected, untestable here and easy to drift.

## Judgment calls (mine)
- 10% minimum shortfall; 1.5 x median; the flag gate stays (minus Ghosted VIP) rather than being replaced by the cadence test alone.

## Review changes (17 Nov 2026)
- The 10% shortfall test and the flags use the whole-window row, not the tab (the tab's own numbers made the count swing, which 2026-10-18 had removed on purpose).
- The p90 allowance is capped at 2 x the median gap (all-time gaps made some clinics skip at-risk before churn).
