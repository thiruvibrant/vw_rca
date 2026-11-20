# Total Tox switch opportunity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** Add the Total Tox -> Toxin Zoomer opportunity to the Growth page.
**Architecture:** Pure logic in `discover` (`src/lib/growthOpps.ts`) from a new `Inputs.switchers`; the page fetches it with a hook and formats a generic "label" column.
**Tech Stack:** TypeScript, React, node:test via `npx --yes tsx --test`.
**Spec:** `docs/superpowers/specs/2026-11-18-total-tox-switch-design.md`

## Global Constraints
- Included groups: stayed ("Not moved over"), lost ("Down on both"), partial ("Partly moved"); id `total-tox-switch`; pillar Product Growth; default target = observed move-over share, 10 when none moved; `cur` 0.

## Review Focus
- No `switchers` (null) or no net loss: no row.
- A group larger than the engine's 300-row cap: `n` and dollars come from counts and `groupDelta`, `clinicIds` from the rows.
- Nobody moved over: default target 10.
- Negative dollars in the list columns display with a minus sign.

### Task 1: Logic and tests
**Files:** Modify `src/lib/growthOpps.ts`; Test `scripts/growth-opps.test.ts`.
**Interfaces:** Produces `SwitchLite = { counts: Record<string, number>; groupDelta: Record<string, number>; rows: Array<{ clinic: string; klass: string; downDelta: number; upDelta: number; netDelta: number }> }`, `Inputs.switchers?: SwitchLite | null`, `OppCol.kind` gains `"label"` (replacing `"offer"`) with `labels?: readonly string[]`.
- [ ] Tests first (see Review Focus), watch FAIL, implement in `discover`, watch PASS, commit.

### Task 2: Page
**Files:** Modify `src/pages/GrowthView.tsx`.
**Interfaces:** Consumes Task 1 types.
- [ ] `useSwitchers(scope)` hook calling `api.families.switchClinicsAction`; pass `switchers` into `discover`; `label` formatter; `money` shows a minus for negatives; `npx tsc -b` clean; commit.
