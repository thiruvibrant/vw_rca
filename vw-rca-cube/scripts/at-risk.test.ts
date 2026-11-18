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

test("a lumpy clinic is allowed its longest usual gap, but never more than two missed intervals", () => {
  assert.equal(isAtRisk(base({ p90GapBd: 8, bdSinceLastOrder: 8 })), false); // 1.5 x 5 = 7.5, its p90 is 8
  assert.equal(isAtRisk(base({ p90GapBd: 8, bdSinceLastOrder: 9 })), true);
  // an old lapse gives a p90 of 43 business days; it is capped at 2 x the median gap (10), so the clinic can still be at risk
  assert.equal(isAtRisk(base({ p90GapBd: 43, bdSinceLastOrder: 9 })), false);
  assert.equal(isAtRisk(base({ p90GapBd: 43, bdSinceLastOrder: 11 })), true);
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

test("Ghosted VIP alone does not make a clinic at risk; the other flags still do", () => {
  assert.equal(isAtRisk(base({ health: ["⏳ Ghosted VIP"] })), false);
  assert.equal(isAtRisk(base({ health: ["⏳ Ghosted VIP", "⏰ Buying Overdue"] })), true);
  assert.equal(isAtRisk(base({ health: ["📉 Revenue Bleed (>25% Drop)"] })), true);
  assert.equal(isAtRisk(base({ health: ["✅ Healthy"] })), false);
});

test("churned or ordered within 5 days is not at risk", () => {
  assert.equal(isAtRisk(base({ life: "churned" })), false);
  assert.equal(isAtRisk(base({ daysSinceLast: 4 })), false);
  assert.equal(isAtRisk(base({ daysSinceLast: null })), false);
});

test("a clinic with no rhythm keeps the fixed 5 to 44 day window", () => {
  const none = { medianGapBd: undefined, p90GapBd: undefined, bdSinceLastOrder: undefined };
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 30 })), true);
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 44 })), true);
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 45 })), false);
  assert.equal(isAtRisk(base({ ...none, daysSinceLast: 3 })), false);
});

test("a clinic whose status is unknown still stops at 45 days", () => {
  assert.equal(isAtRisk(base({ life: undefined, daysSinceLast: 50 })), false);
});

test("buyingGapP90: nearest-rank 90th percentile of business-day gaps, 3+ distinct order dates", () => {
  assert.equal(buyingGapP90(["2026-09-07", "2026-09-14", "2026-09-28"], "2026-10-05"), 10); // gaps 5 and 10
  assert.equal(buyingGapP90(["2026-09-07", "2026-09-14"], "2026-10-05"), undefined);
  assert.equal(buyingGapP90(["2026-09-07", "2026-09-07", "2026-09-14"], "2026-10-05"), undefined); // two distinct dates
  assert.equal(buyingGapP90(["2026-09-14", "2026-09-07", "2026-09-28", "2026-12-01"], "2026-10-05"), 10); // dates after the cutoff are ignored
});

test("the same clinics are at risk on every tab: the shortfall test uses the whole analysis window, not the tab", () => {
  const whole = { health: [SLIP], baseline: 9100, realChange: -2000 }; // 22% under baseline over the whole window
  const row = (baseline: number, realChange: number) => ({ ...base(), baseline, realChange, health: ["✅ Healthy"] });
  // week tab (strong shortfall), month tab (small), all tab (above baseline): one answer, taken from the whole window
  for (const [b, r] of [[700, -700], [3000, -200], [9100, 500]]) assert.equal(isAtRiskInWindow(row(b, r), whole), true);
  assert.equal(isAtRiskInWindow(row(700, -700), { ...whole, realChange: 500 }), false);
  // without a whole-window row the tab's own numbers are used
  assert.equal(isAtRiskInWindow({ ...base(), realChange: -300 }, undefined), true);
});
