import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLists, credentialGroup, topCut, type GutData } from "../analytics/gutLists.ts";

const empty = (): GutData => ({
  rev: new Map(), vwRev: new Map(), gzA: new Map(), gzB: new Map(), gzARev: new Map(), gzLast: new Map(), gz25: new Map(), gz25Rev: new Map(),
  gz26: new Set(), fz26: new Set(), baseline26: new Set(), zoomers26: new Map(), ordersMarOct: new Map(), gzMarOct: new Map(), ordersB: new Map(), peer: new Map(),
});
/** Ten clinics with revenue 100..1000: the top 20% are the two with 900 and 1000. */
const base = () => {
  const d = empty();
  for (let i = 1; i <= 10; i++) { d.rev.set(String(i), i * 100); d.vwRev.set(String(i), i * 100); }
  return d;
};

test("the top 20% is the fifth of clinics with the most revenue", () => {
  assert.equal(topCut([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]), 900);
  assert.equal(topCut([0, 0]), 0);
});

test("list 1: top clinic with 5+ Gut Zoomer in Mar–Jun, none since July, and no restart by 10 Nov", () => {
  const d = base();
  d.gzA.set("10", 6); d.gzARev.set("10", 3300); d.gzLast.set("10", "2026-06-20"); d.ordersB.set("10", 4);
  d.gzA.set("9", 6); d.gzLast.set("9", "2026-11-09"); d.gzB.set("9", 0); // restarted on 9 Nov: not stopped
  d.gzA.set("8", 6); // not top 20%
  const l = buildLists(d);
  assert.deepEqual(l.stopped.map(r => r.clinic), ["10"]);
  assert.equal(l.stopped[0].otherOrders, 4);
  assert.equal(l.stopped[0].daysSince, 143); // 20 Jun to 10 Nov
});

test("list 4 and list 5 split the top clinics that have no Gut Zoomer in 2026, and a clinic is on one list only", () => {
  const d = base();
  d.gz25.set("10", 8); d.gz25Rev.set("10", 4000); d.zoomers26.set("10", ["Hormone Zoomer"]); d.fz26.add("10");
  d.gz25.set("9", 1); // not a 5+ order Gut Zoomer clinic of 2025
  const l = buildLists(d);
  assert.deepEqual(l.lost.map(r => r.clinic), ["10"]);
  assert.equal(l.lost[0].fz, true);
  // 9 has no gut or FZ testing in 2026 and is VW-dependent: list 5. 10 is already on list 4.
  assert.deepEqual(l.noGut.map(r => r.clinic), ["9"]);
});

test("list 5 leaves out clinics that are not VW-dependent or that order Gut Baseline", () => {
  const d = base();
  d.vwRev.set("10", 100); // 10% of revenue
  d.baseline26.add("9");
  const l = buildLists(d);
  assert.deepEqual(l.noGut, []);
});

test("list 3: far fewer Gut Zoomer orders than same-credential clinics in the same ZIP area", () => {
  const d = base();
  const p = { cred: "NP", zip3: "658", state: "MO" };
  d.peer.set("10", p);
  for (let i = 1; i <= 6; i++) { d.peer.set(`p${i}`, p); d.ordersMarOct.set(`p${i}`, 100); d.gzMarOct.set(`p${i}`, 40); }
  d.ordersMarOct.set("10", 100); d.gzMarOct.set("10", 5); // 5% against 40%
  d.gzA.set("10", 2); d.gzARev.set("10", 1100);
  const l = buildLists(d);
  assert.deepEqual(l.similar.map(r => r.clinic), ["10"]);
  assert.equal(l.similar[0].peerScope, "zip");
  assert.equal(l.similar[0].peers, 6);
  assert.ok(l.similar[0].gapRevenue > 0);
  // a clinic with close to the peers' rate is not listed
  d.gzMarOct.set("10", 30);
  assert.deepEqual(buildLists(d).similar, []);
});

test("list 3 falls back to the state when the ZIP area has fewer than 5 peers", () => {
  const d = base();
  d.peer.set("10", { cred: "MD", zip3: "111", state: "TX" });
  for (let i = 1; i <= 5; i++) { d.peer.set(`p${i}`, { cred: "MD", zip3: `2${i}0`, state: "TX" }); d.ordersMarOct.set(`p${i}`, 100); d.gzMarOct.set(`p${i}`, 30); }
  d.ordersMarOct.set("10", 50); d.gzMarOct.set("10", 2);
  assert.equal(buildLists(d).similar[0]?.peerScope, "state");
});

test("credentials are grouped", () => {
  assert.equal(credentialGroup("FNP-C"), "NP");
  assert.equal(credentialGroup("M.D."), "MD");
  assert.equal(credentialGroup("D.C."), "DC");
  assert.equal(credentialGroup("DO"), "DO");
  assert.equal(credentialGroup(""), "Others");
  assert.equal(credentialGroup("PhD"), "Others");
});

test("the reference rate is the yearly Gut Zoomer orders of a top clinic that orders it", () => {
  const d = base();
  d.gzMarOct.set("10", 8); // top clinic: 8 in eight months = 12 a year
  d.gzMarOct.set("9", 4);  // top clinic: 6 a year
  d.gzMarOct.set("3", 40); // not a top clinic: ignored
  assert.equal(buildLists(d).refGzOrdersYear, 9);
});

test("list 2: new patients getting a Gut Zoomer fell, and a clinic on list 1 is not on list 2", () => {
  const d = base();
  d.newPat = new Map([
    ["10", { a: 20, aGz: 12, b: 15, bGz: 5 }], // 60% then 33%: drop of 27 points
    ["9", { a: 20, aGz: 12, b: 15, bGz: 10 }], // 60% then 67%: no drop
    ["8", { a: 20, aGz: 12, b: 15, bGz: 5 }], // not a top clinic
  ]);
  d.follow = new Map();
  const l = buildLists(d);
  assert.deepEqual(l.newPatients.map(r => r.clinic), ["10"]);
  assert.ok(Math.abs(l.newPatients[0].shareA - 0.6) < 1e-9);
  // a clinic that is on list 1 (stopped) never reaches list 2
  d.gzA.set("10", 6); d.gzARev.set("10", 3000); d.gzLast.set("10", "2026-06-20");
  const l2 = buildLists(d);
  assert.deepEqual(l2.stopped.map(r => r.clinic), ["10"]);
  assert.deepEqual(l2.newPatients, []);
  assert.equal(l2.patients, true);
});

test("list 6: 5+ patients due or overdue, after lists 1 to 3, before lists 4 and 5", () => {
  const d = base();
  d.newPat = new Map();
  d.follow = new Map([["10", { due: 3, overdue: 4 }], ["9", { due: 2, overdue: 1 }]]);
  d.gz25.set("10", 8); d.gz25Rev.set("10", 4000); d.zoomers26.set("10", ["Hormone Zoomer"]);
  const l = buildLists(d);
  assert.deepEqual(l.followUp.map(r => r.clinic), ["10"]);
  assert.deepEqual(l.lost, []); // 10 is on list 6 first
  assert.deepEqual(l.noGut.map(r => r.clinic), ["9"]);
});

test("without the patient key, lists 2 and 6 are left out and the others still build", () => {
  const l = buildLists(base());
  assert.equal(l.patients, false);
  assert.deepEqual(l.newPatients, []);
  assert.deepEqual(l.followUp, []);
});
