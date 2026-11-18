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
