# At-risk cadence-aware definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or subagent-driven-development.

**Goal:** At-risk customers use the clinic's own order rhythm, a minimum shortfall and no Ghosted VIP, on every page.

**Architecture:** A pure `isAtRisk` in `analytics/atRisk.ts` plus `buyingGapP90` in `analytics/flags.ts`; the p90 gap and cadence fields flow from refresh -> clinicMeta -> clinic rows -> `atRiskRows`. Help text updated.

**Tech Stack:** TypeScript, node:test via `npx --yes tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-at-risk-cadence-design.md`

## Global Constraints
- Thresholds: min 5 days since last order; lateRatio 1.5 on max(median gap, 2); p90 gap also exceeded; minShortfall 0.10 of baseline; fallback fixed window 5-44 days when the clinic has no rhythm.
- Flags that count: /slipping|overdue|risk|drop/i (Ghosted VIP excluded).
- Additive optional schema field `p90GapBd`; no change to existing field names.

## Review Focus
- Clinic with <3 order dates (no rhythm): old 5-44 day rule still applies.
- `p90GapBd` missing (before the next refresh): 1.5 x median alone.
- A clinic above baseline (realChange >= 0) is never at risk.
- Ghosted VIP alone does not make a clinic at risk.
- A clinic on a long natural cadence at day 35 is not at risk; at 2x its gap it is.

### Task 1: Rule and p90 gap (pure, tested)
**Files:** Create `analytics/atRisk.ts`, `scripts/at-risk.test.ts`; Modify `analytics/flags.ts`.
**Interfaces:** Produces `export function buyingGapP90(orderDates: readonly string[], cutoff: string): number | undefined` (nearest-rank 90th percentile of business-day gaps, needs 3+ distinct dates, same eligibility as `buyingRhythm`); `export type AtRiskInput = { life?: string; daysSinceLast: number | null; medianGapBd?: number; p90GapBd?: number; bdSinceLastOrder?: number; baseline: number; realChange: number; health: readonly string[] }`; `export function isAtRisk(i: AtRiskInput): boolean`; `export const AT_RISK`.
- [ ] Tests first (named per Review Focus plus a p90 test), run to see FAIL, implement, run to see PASS, commit.

### Task 2: Plumb p90 and cadence to the rows
**Files:** Modify `analytics/schema.ts` (clinicMeta), `analytics/ingest.ts` (validator), `analytics/refresh.ts` (both rhythm blocks and both clinicMeta writes), `analytics/clinics.ts` (ClinicRow type and `rows.push`).
**Interfaces:** Consumes `buyingGapP90` (Task 1). Produces `ClinicRow.medianGapBd?`, `ClinicRow.p90GapBd?`, `ClinicRow.bdSinceLastOrder?`.
- [ ] Add fields; `npx tsc --noEmit -p analytics` passes; commit.

### Task 3: Use the rule
**Files:** Modify `analytics/repView.ts` (`atRiskRows`).
**Interfaces:** Consumes `isAtRisk`, the row fields from Task 2, `healthAll`.
- [ ] Replace the two filters with one `isAtRisk` call (days since last from the existing `since(cutoff, r.lastOrderAllTime)`); typecheck; commit.

### Task 4: Help text on every page
**Files:** Modify `src/pages/ScorecardGuide.tsx` (at-risk `how`/`watch`), `src/pages/Faq.tsx` ("What is at risk?"), `src/pages/RepView.tsx` (At-Risk Revenue help near line 2821), `src/lib/growthOpps.ts` (at-risk observation and evidence).
- [ ] Update copy to the rule in the spec; `npx tsc -b` clean, growth-opps tests pass; commit.
