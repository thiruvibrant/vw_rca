import assert from "node:assert/strict";
import { test } from "node:test";
import { inCallFirstWindow } from "../analytics/callFirst.ts";

test("Call-first: ordered 5+ days ago and not churned by the clinic's own threshold, so a slow buyer stays on past day 45", () => {
  assert.equal(inCallFirstWindow(5, false), true);
  assert.equal(inCallFirstWindow(4, false), false);
  assert.equal(inCallFirstWindow(60, false), true); // slow rhythm, not churned yet
  assert.equal(inCallFirstWindow(60, true), false);
  assert.equal(inCallFirstWindow(null, false), false);
});

import { AT_RISK_TAG, largestAtRisk, onCallFirstTag } from "../analytics/callFirst.ts";

test("the At risk chip matches the clinics on the At-risk card; a health chip matches clinics carrying that flag", () => {
  const atRisk = new Set(["1", "2"]);
  assert.equal(AT_RISK_TAG, "At risk · top 20%");
  assert.equal(onCallFirstTag(AT_RISK_TAG, "1", ["✅ Healthy"], atRisk), true); // at risk whatever flags it carries
  assert.equal(onCallFirstTag(AT_RISK_TAG, "3", ["⚠️ Slipping Away (Late)"], atRisk), false);
  assert.equal(onCallFirstTag("⚠️ Slipping Away (Late)", "3", ["⚠️ Slipping Away (Late)"], atRisk), true);
  assert.equal(onCallFirstTag("⚠️ Slipping Away (Late)", "1", ["✅ Healthy"], atRisk), false);
});

test("the At risk chip keeps only the largest 20% of the active existing clinics, by whole-window baseline", () => {
  const active = Array.from({ length: 10 }, (_, i) => ({ clinic: String(i + 1), baseline: (i + 1) * 100 })); // 100..1000, the top 20% reach 900
  const atRisk = new Set(["1", "8", "9", "10", "99"]); // 99 is not an active existing clinic
  assert.deepEqual([...largestAtRisk(active, atRisk)].sort(), ["10", "9"]);
  assert.deepEqual([...largestAtRisk(active, atRisk, 0.5)].sort(), ["10", "8", "9"]); // top half: baseline 600+
  assert.deepEqual([...largestAtRisk([], atRisk)], []);
  assert.deepEqual([...largestAtRisk(active.map(a => ({ ...a, baseline: 0 })), atRisk)], []); // no baseline, no one is large
});
