# Total Tox -> Toxin Zoomer opportunity (short design)

Approved in conversation, 18 Nov 2026 ("yes proceed").

## Intent
The Business Feed asks "Is Toxin Zoomer offsetting the Total Tox downfall?" and opens a clinic list that sorts clinics by whether Toxin Zoomer picked up what they stopped ordering of Total Tox. The Growth page gets an opportunity from the clinics where it did not.

## Goals
- One opportunity, "Move clinics that dropped Total Tox over to Toxin Zoomer", pillar Product Growth, source "supporting".
- Who: the clinics in the switch list's groups "Not moved over" (dropped Total Tox, no Toxin Zoomer), "Down on both" and "Partly moved" (Toxin Zoomer picked up under 60% of the lost orders). Left out: "Moved over" (already offset), "Total Tox flat or up" and "Toxin Zoomer only" (no drop to recover).
- Sizing: the groups' combined net revenue below baseline (Total Tox plus Toxin Zoomer, from the engine's `groupDelta`), carried to a year from the analysis window. Per clinic value = that total / clinic count. Default target = the observed share of clinics that dropped Total Tox and moved over (moved / (moved + the three groups)), or 10% when none moved; editable.
- Clinic list: columns for the group (Not moved over / Down on both / Partly moved) and each clinic's Total Tox and Toxin Zoomer revenue change against baseline.
- Data: the engine's existing `families:switchClinicsAction` (period "all", Total Tox -> Toxin Zoomer, limit 300; a team lead's scope is passed as `sales`). No engine change.

## Non-goals
- No overlap carve-out against other rows (the page total already counts each clinic once).
- No per-group opportunities.

## Constraints
- The engine returns at most 300 clinics per group: counts and dollars are full, the clinic list is the top 300 per group by loss.
- The comparison is against each clinic's baseline over the analysis window.
- If the call fails the row is simply missing (same as the other engine-fed rows).

## Approaches considered
1. One opportunity over three groups with a group column (chosen).
2. Three opportunities, one per group: rejected, triples the rows for one story.
