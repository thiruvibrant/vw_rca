import assert from "node:assert/strict";
import { test } from "node:test";
import { isAtRisk, isAtRiskInWindow, type AtRiskInput } from "../analytics/atRisk.ts";
import { buyingGapP90 } from "../analytics/flags.ts";

const SLIP = "⚠️ Slipping Away (Late)";
/** A clinic that usually orders every 5 business days, with its longest usual gap 8, now 15 business days (20 days) quiet and 30% under baseline. */
const base = (o: Partial<AtRiskInput> = {}): AtRiskInput => ({ life: "active", daysSinceLast: 20, medianGapBd: 5, p90GapBd: 8, bdSinceLastOrder: 15, baseline: 1000, realChange: -300, health: [SLIP], ...o });

test("late against its own rhythm, below baseline and flagged: at risk", () => {
  assert.equal(isAtRisk(base()), true);
});

test("on its own cadence is not at risk, and a long natural cadence at day 35 is not at risk", () => {
  assert.equal(isAtRisk(base({ bdSinceLastOrder: 7 })), false); // under 1.5 x 5
  assert.equal(isAtRisk(base({ daysSinceLast: 35, medianGapBd: 30, p90GapBd: 40, bdSinceLastOrder: 25 })), false);
  assert.equal(isAtRisk(base({ daysSinceLast: 70, medianGapBd: 30, p90GapBd: 40, bdSinceLastOrder: 50 })), true); // past 1.5 x its gap and its longest usual gap
});

test("a lumpy clinic is allowed its longest usual gap, up to 80% of the way to its churn line", () => {
  assert.equal(isAtRisk(base({ p90GapBd: 8, bdSinceLastOrder: 8 })), false); // 1.5 x 5 = 7.5, its p90 is 8
  assert.equal(isAtRisk(base({ p90GapBd: 8, bdSinceLastOrder: 9 })), true);
  // churn is about max(31, 3 x median) = 31 business days, so "late" never waits past 0.8 x 31 = 24.8 even with a p90 of 43
  assert.equal(isAtRisk(base({ p90GapBd: 43, bdSinceLastOrder: 24 })), false);
  assert.equal(isAtRisk(base({ p90GapBd: 43, bdSinceLastOrder: 25 })), true);
});

test("a bursty buyer (three days in a row, then five weeks off) is not at risk during its usual lull", () => {
  const bursty = { medianGapBd: 1, p90GapBd: 22, daysSinceLast: 20 };
  assert.equal(isAtRisk(base({ ...bursty, bdSinceLastOrder: 10 })), false);
  assert.equal(isAtRisk(base({ ...bursty, bdSinceLastOrder: 22 })), false);
  assert.equal(isAtRisk(base({ ...bursty, bdSinceLastOrder: 23, daysSinceLast: 33 })), true);
});

test("before the p90 gap is stored, 1.5 x the median alone applies", () => {
  assert.equal(isAtRisk(base({ p90GapBd: undefined, bdSinceLastOrder: 8 })), true); // 8 > 7.5
  assert.equal(isAtRisk(base({ p90GapBd: undefined, bdSinceLastOrder: 7 })), false);
});

test("a real shortfall is needed: at least 10% of baseline", () => {
  assert.equal(isAtRisk(base({ realChange: -100 })), true);
  assert.equal(isAtRisk(base({ realChange: -99 })), false);
  assert.equal(isAtRisk(base({ realChange: 250 })), false); // above baseline is never at risk
  assert.equal(isAtRisk(base({ baseline: 0, realChange: -10 })), false);
});

test("with a rhythm no flag is needed: lateness and shortfall decide, so a clinic without a Bleed flag is still caught early", () => {
  assert.equal(isAtRisk(base({ health: ["✅ Healthy"] })), true);
  assert.equal(isAtRisk(base({ health: ["⏳ Ghosted VIP"] })), true); // late and short, whatever else it carries
  assert.equal(isAtRisk(base({ health: ["⏳ Ghosted VIP"], bdSinceLastOrder: 7 })), false); // a missed call alone does not make it at risk
});

test("churned or ordered within 5 days is not at risk", () => {
  assert.equal(isAtRisk(base({ life: "churned" })), false);
  assert.equal(isAtRisk(base({ daysSinceLast: 4 })), false);
  assert.equal(isAtRisk(base({ daysSinceLast: null })), false);
});

test("a clinic with no rhythm keeps the fixed 5 to 44 day window and needs a slipping, overdue or bleed flag", () => {
  const none = { medianGapBd: undefined, p90GapBd: undefined, bdSinceLastOrder: undefined };
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 30 })), true);
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 44 })), true);
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 45 })), false);
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 3 })), false);
  assert.equal(isAtRisk(base({ ...none, health: ["✅ Healthy"] })), false);
  assert.equal(isAtRisk(base({ ...none, health: ["⏳ Ghosted VIP"] })), false);
  assert.equal(isAtRisk(base({ ...none, health: ["📉 Revenue Bleed (>25% Drop)"] })), true);
});

test("a clinic whose status is unknown still stops at 45 days", () => {
  assert.equal(isAtRisk(base({ life: undefined, daysSinceLast: 50 })), false);
});

const weekly = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 7 * 864e5).toISOString().slice(0, 10));

test("buyingGapP90: nearest-rank 90th percentile of the last 12 months of gaps, trusted only with 10+ gaps", () => {
  // nine weekly gaps (Mon to Mon, 5 business days, no holiday) then one long gap: ten gaps, the single outlier is ignored
  const nine = weekly("2026-03-02", 10);
  assert.equal(buyingGapP90([...nine, "2026-06-29"], "2026-10-05"), 5);
  // two long gaps are not ignored
  assert.ok(buyingGapP90([...nine, "2026-06-01", "2026-09-28"], "2026-10-05")! > 5);
  // nine gaps are too few to trust a 90th percentile
  assert.equal(buyingGapP90(weekly("2026-03-02", 10), "2026-10-05"), undefined);
  // order dates after the cutoff are ignored
  assert.equal(buyingGapP90([...nine, "2026-06-29", "2026-12-07"], "2026-10-05"), 5);
});

test("buyingGapP90 ignores orders older than 12 months, so an old lapse cannot stretch the allowance", () => {
  const old = weekly("2024-03-04", 12); // twelve weekly orders in 2024
  assert.equal(buyingGapP90([...old, "2026-09-07", "2026-09-14", "2026-09-21"], "2026-10-05"), undefined); // only three dates in the last 12 months
});
