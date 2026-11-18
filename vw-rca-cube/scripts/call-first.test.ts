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

import { AT_RISK_TAG, onCallFirstTag } from "../analytics/callFirst.ts";

test("the At risk chip matches the clinics on the At-risk card; a health chip matches clinics carrying that flag", () => {
  const atRisk = new Set(["1", "2"]);
  assert.equal(AT_RISK_TAG, "At risk");
  assert.equal(onCallFirstTag(AT_RISK_TAG, "1", ["✅ Healthy"], atRisk), true); // at risk whatever flags it carries
  assert.equal(onCallFirstTag(AT_RISK_TAG, "3", ["⚠️ Slipping Away (Late)"], atRisk), false);
  assert.equal(onCallFirstTag("⚠️ Slipping Away (Late)", "3", ["⚠️ Slipping Away (Late)"], atRisk), true);
  assert.equal(onCallFirstTag("⚠️ Slipping Away (Late)", "1", ["✅ Healthy"], atRisk), false);
});
