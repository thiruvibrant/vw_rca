import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays } from "../analytics/dateUtils.ts";
import { evaluateFlags, FLAG, type OperationalInputs } from "../analytics/flags.ts";

const CUTOFF = "2026-09-21";
const perf = { actual: 100, expected: 100, orders: 5, expectedOrders: 5, bundleOrders: 0, expectedBundleOrders: 0 };
const op = (daysQuiet: number, life?: string, o: Partial<OperationalInputs> = {}): OperationalInputs => ({
  ytdOrders: 10, ytdRevenue: 5000, lastOrderAllTime: addDays(CUTOFF, -daysQuiet), firstOrder: "2025-01-01", touchDataAvailable: false, life, ...o,
});
const flags = (daysQuiet: number, life?: string) => evaluateFlags(CUTOFF, op(daysQuiet, life), perf);

test("a slow buyer 77 days quiet whose own churn line is 138 days is Slipping Away, not Churned / Lost", () => {
  const f = flags(77, "active");
  assert.equal(f.includes(FLAG.CHURNED), false);
  assert.equal(f.includes(FLAG.SLIPPING_AWAY), true);
});

test("Churned / Lost follows the clinic's own churn status, including a fast clinic past its 45-day line", () => {
  assert.equal(flags(77, "churned").includes(FLAG.CHURNED), true);
  assert.equal(flags(77, "churned").includes(FLAG.SLIPPING_AWAY), false);
  assert.equal(flags(50, "churned").includes(FLAG.CHURNED), true); // churned on the scorecard's churn dial at 45 days
  assert.equal(flags(200, "active").includes(FLAG.CHURNED), false); // a slow buyer not yet past its own line
});

test("without a churn status the old fixed rule still applies", () => {
  assert.equal(flags(77).includes(FLAG.CHURNED), true);
  assert.equal(flags(45).includes(FLAG.SLIPPING_AWAY), true);
  assert.equal(flags(45).includes(FLAG.CHURNED), false);
});

test("a clinic that ordered recently has neither flag, and one silent over a year gets no flags at all", () => {
  const f = flags(20, "active");
  assert.equal(f.includes(FLAG.CHURNED) || f.includes(FLAG.SLIPPING_AWAY), false);
  assert.deepEqual(flags(400, "churned"), []);
});
