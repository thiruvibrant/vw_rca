# Baseline candidates replace the low-AOV opportunity (short design)

Approved in conversation, 17 Nov 2026.

## Intent
Clinics that have only tried Gut Zoomer, Foundation Zoomer or Hormone Zoomer once or twice, and run a low AOV, are the natural buyers of the lower-priced baseline tests. The Growth page's low-AOV row (a scorecard count with no product knowledge) is replaced by an opportunity that names the clinics and the baseline to offer. Each clinic is in exactly one opportunity.

## Goals
- One opportunity, "Offer a baseline test to low-AOV clinics that tried a Zoomer", replaces `low-aov`.
- Who: ordering clinics under $400 AOV with 1 or 2 orders of Gut Zoomer, Foundation Zoomer or Hormone Zoomer in the analysis window (the same window as the AOV). The Hormone Zoomer part is a stated call; the request named Gut and Foundation.
- Offer by trial product: Gut Zoomer -> Gut Baseline ($460), Foundation Zoomer -> Foundation Baseline ($400), Hormone Zoomer -> Hormone Baseline ($420). A clinic with trials in several products is listed once, under the product with the most orders (ties: Gut, Foundation, Hormone).
- Precedence, so no clinic is counted twice: Thiru's six lists claim their clinics first. Clinics that are on none of them and qualify here go to this opportunity, and this opportunity then takes priority over the rows that would pitch the same clinic a product: the clinics are removed from FZ targets, the nurture pool, and the Gut Baseline / Gut Zoomer-from-FZ row. Retention rows (at-risk, reactivate) are about order recency and stay as they are; the page's totals already count each clinic once.
- The opportunity is built only once Thiru's lists have loaded; without them it would claim clinics they may then claim, so the row is left out until they arrive.
- Sizing: value per clinic = baseline price x typical yearly orders of that product (measured as the mean yearly orders of clinics that order it 3+ times). Adoption share is an editable assumption, default 10% for every baseline. The evidence text says only extra orders count, because swapping a Zoomer for a cheaper baseline lowers revenue.
- Clinic list columns: trial orders and the baseline to offer (a new `offer` column kind that shows the name).

## Non-goals
- No per-baseline adoption defaults yet.
- No change to Thiru's list rules.
- Clinics under $400 AOV with no trial order are no longer shown (accepted).

## Anti-goals
- A clinic must never appear in this opportunity and in another row, or be double counted in the totals.

## Constraints
- Per-clinic orders by product family for the window are already on the Growth page (`usePG`, `win`), so no engine change or redeploy.
- The precedence rule lives in the pure `discover` logic with tests, not in the page.
- Foundation Baseline and Hormone Baseline are new products; there is no order history for them yet, so adoption is not measured.

## Approaches considered
1. Carve-out inside `discover` (chosen): the new opportunity is built last and removes its clinics from the other rows. One place owns the rule and tests cover it.
2. Filter at display time in the page: rejected, it would leave totals and the map double counting.
3. A generic precedence layer across all opportunities: rejected for now, larger than the request.

## Left to the builder
Where the new rows sit in the Product Growth pillar, wording, and the exact engine query shape. The pillar "Bundle growth" will have no opportunity for now.
