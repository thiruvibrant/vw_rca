# Baseline candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Growth page's low-AOV opportunity with "Offer a baseline test to low-AOV clinics that tried a Zoomer", exclusive of Thiru's six lists and ahead of the rows that would pitch the same clinic a product.

**Architecture:** Pure logic in `discover` (`src/lib/growthOpps.ts`) computes the candidates from the book's low-AOV ids, per-clinic orders by family already on the page, and Thiru's lists. The page only passes the new input and formats one new column kind. No engine or Convex change.

**Tech Stack:** TypeScript, React, node:test via `npx --yes tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-baseline-candidates-design.md`

## Global Constraints

- Baselines and prices: Gut Zoomer -> Gut Baseline $460; Foundation Zoomer -> Foundation Baseline $400; Hormone Zoomer -> Hormone Baseline $420.
- "Few" = 1 or 2 orders of the family in the analysis window; 3+ is a regular buyer and not a candidate.
- Default target rate 10 for every baseline (`tgt: 10`, `cur: 0`).
- Thiru's six lists take precedence: stopped, newPatients, similar, lost, noGut, followUp.
- No clinic may appear in this opportunity and in FZ targets, the nurture pool, the gut-fz row or any of Thiru's lists.
- Pillar "Product Growth"; id `baseline-candidates`; the `low-aov` opportunity no longer exists.
- Repo copy rules: plain sentences, no em dashes in UI text.

## Review Focus

- A clinic with trial orders in two families is listed once, under the family with more orders (tie: Gut, Foundation, Hormone).
- A clinic with 0 orders, or 3+ orders, of every trial family is not a candidate.
- Gut lists not loaded yet (`inp.gut` null): no baseline row, and the other rows are unchanged.
- A family nobody orders 3+ times has no measured frequency: its clinics are listed with value 0, not an invented number.
- Family keys match case-insensitively ("gut zoomer" vs "Gut Zoomer").

---

### Task 1: Candidate logic, sizing and carve-out in `discover`

**Files:**
- Modify: `vw-rca-cube/src/lib/growthOpps.ts` (types near `Inputs`, the `low-aov` block at the top of `discover`, the fz and nurture blocks)
- Test: `vw-rca-cube/scripts/growth-opps.test.ts`

**Interfaces:**
- Produces: `export type FamLite = { clinic: string; win: Record<string, number> }`; `Inputs.families?: FamLite[] | null`; `export const BASELINES: ReadonlyArray<{ family: string; baseline: string; price: number }>`; `export function baselineCandidates(inp: Inputs): Array<{ clinic: string; family: string; orders: number; baseline: string; price: number }>`; `OppCol.kind` gains `"offer"`.

- [ ] **Step 1: Write the failing tests** in `scripts/growth-opps.test.ts` (extend `inputs()` with `families` and a `gut`): 
  - `low-AOV is replaced by baseline candidates`: `discover(inputs()).some(d => d.id === "low-aov") === false`; update the existing "low-AOV and at-risk" test to assert only at-risk.
  - `baselineCandidates picks low-AOV clinics with 1 or 2 orders of a trial family`: clinic 1 Gut Zoomer 2, clinic 2 Foundation Zoomer 1 and Gut Zoomer 2 (-> Gut), clinic 3 Gut Zoomer 3 (excluded), clinic 4 not low-AOV (excluded), clinic 5 in `gut.lists.noGut` (excluded). Expect clinics `["1","2"]` with baselines `Gut Baseline` and prices 460.
  - `a tie goes Gut, then Foundation, then Hormone` and `family keys match case-insensitively`.
  - `no gut lists, no baseline row`: `inputs()` with `gut: null` has no `baseline-candidates` id.
  - `sizing`: value per clinic = price x yearly orders of clinics ordering the family 3+ times (mean of `win[f]` x `annualFactor(windowDays)`); `annual` = sum; a family with no 3+ buyer contributes 0.
  - `exclusive`: for every clinic id in `baseline-candidates`, it is in none of the `fz-targets`, `gut-fz`, `second-order` `clinicIds`; `second-order` has `n` reduced and `n x value` scaled to the remaining ids.

- [ ] **Step 2: Run** `cd vw-rca-cube && npx --yes tsx --test scripts/growth-opps.test.ts`. Expected: FAIL (`baselineCandidates` not exported).

- [ ] **Step 3: Implement** `BASELINES`, `FamLite`, `Inputs.families`, `baselineCandidates(inp)` and the `baseline-candidates` OppDef (name "Offer a baseline test to low-AOV clinics that tried a Zoomer", pillar "Product Growth", source "supporting", metric "AOV", `unit` default, cols `[{key:"blTrial",label:"Zoomer orders",kind:"int"},{key:"blOffer",label:"Offer",kind:"offer",values: index 1/2/3 by BASELINES order}]`) in `src/lib/growthOpps.ts`. Remove the `low-aov` block. Compute `claimed` first in `discover`; filter `fz.clinics` by `!claimed.has(c.clinic)` before `build`; for the nurture row use the ids not claimed, `n` = their count, `up` scaled by `n'/n`. Evidence text states only extra orders count because swapping a Zoomer for a cheaper baseline lowers revenue. Add `"offer"` to `OppCol.kind`.

- [ ] **Step 4: Run** the same command. Expected: all tests pass (previous count plus the new ones).

- [ ] **Step 5: Commit** `git add vw-rca-cube/src/lib/growthOpps.ts vw-rca-cube/scripts/growth-opps.test.ts && git commit -m "Growth: baseline candidates replace low-AOV, after Thiru's lists"`

### Task 2: Wire the page and format the new column

**Files:**
- Modify: `vw-rca-cube/src/pages/GrowthView.tsx` (the `fmts` map near line 20, the `discover({...})` call near line 330)

**Interfaces:**
- Consumes: `Inputs.families`, `OppCol.kind: "offer"` from Task 1; `pgd.data.clinics` (`PGClinic`, has `clinic` and `win`).

- [ ] **Step 1:** Add the `offer` formatter to `fmts`: `(n) => BASELINES[n - 1]?.baseline ?? ""` (import `BASELINES`). The extra-columns code in `OppClinics` already sorts on the numeric value.
- [ ] **Step 2:** Pass `families: pgd.data?.clinics.map(c => ({ clinic: c.clinic, win: c.win })) ?? null` into `discover`, and add `pgd.data` to the `useMemo` dependencies.
- [ ] **Step 3: Verify** `cd vw-rca-cube && npx tsc -b 2>&1 | grep -v -i usertour` prints nothing, and `npx --yes tsx --test scripts/growth-opps.test.ts scripts/gut-lists.test.ts` passes.
- [ ] **Step 4: Commit** `git add vw-rca-cube/src/pages/GrowthView.tsx && git commit -m "Growth page: pass per-clinic family orders, show the baseline to offer"`
