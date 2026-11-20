// Offline checks for the week plan's "If you follow this plan" preview (src/lib/planImpact.ts) and the Growth opportunity link
// (src/lib/planLink.ts). No Cube, no Convex.
//   npx tsx scripts/plan-impact.test.ts
import assert from "node:assert/strict";
import { actionImpact, cellImpact, dedupedExpected, dialImpact, doFirst, filterQueue, marginalFill } from "../src/lib/planImpact";
import { growthActions, PLAN_ACTIONS_OF } from "../src/lib/planLink";
import { PILLARS } from "../src/lib/growthOpps";
import type { Opp } from "../src/lib/growthOpps";

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

test("a clinic in two actions counts once, at its larger share", () => {
  const rows = [
    { id: "callFirst", p: "Retention", ids: ["a", "b"], exp: 200, pr: 0.5 }, // 100 each
    { id: "atRisk", p: "Retention", ids: ["b", "c"], exp: 60, pr: 0.4 }, // 30 each
    { id: "secondOrder", p: "New Business", ids: ["d"], exp: 50, pr: 0.6 },
  ];
  const d = dedupedExpected(rows);
  assert.equal(d.byPillar.Retention, 100 + 100 + 30); // a 100, b max(100,30), c 30
  assert.equal(d.byPillar["New Business"], 50);
  assert.equal(d.total, 280);
});

test("dials: New Business into New revenue, everything else into Existing business, both into Combined", () => {
  const rows = [
    { id: "x", p: "Retention", ids: ["a"], exp: 100, pr: 0.5 },
    { id: "y", p: "Product Growth", ids: ["b"], exp: 40, pr: 0.5 },
    { id: "z", p: "New Business", ids: ["c"], exp: 25, pr: 0.5 },
  ];
  const dials = dialImpact(rows, { heading: 1000, plan: 1300, existingHeading: 900, existingPlan: 1100, newHeading: 100, newPlan: 200 });
  assert.deepEqual(dials.map(x => [x.key, x.now, x.withPlan, x.goal]), [
    ["existing", 900, 1040, 1100],
    ["new", 100, 125, 200],
    ["combined", 1000, 1165, 1300],
  ]);
  // Without the split from the engine, only Combined.
  assert.deepEqual(dialImpact(rows, { heading: 10, plan: 20 }).map(x => x.key), ["combined"]);
});

test("cells: count drops by the chance each planned clinic works; a rate uses its base", () => {
  const rows = [
    { id: "atRisk", p: "Retention", ids: ["a", "b"], exp: 10, pr: 0.5 },
    { id: "callFirst", p: "Retention", ids: ["b"], exp: 10, pr: 0.7 },
    { id: "churned", p: "Retention", ids: ["x"], exp: 10, pr: 0.25 },
  ];
  const [atRisk, churn] = cellImpact(rows, [
    { label: "At-risk customers", ids: ["a", "b", "q"], now: 3 },
    { label: "Customer churn", ids: ["x", "y"], now: 0.2, base: 10 },
  ]);
  assert.equal(atRisk.moved, 0.5 + 0.7); // b's best chance
  assert.equal(atRisk.after, 3 - 1.2);
  assert.equal(churn.rate, true);
  assert.ok(Math.abs(churn.after - (2 - 0.25) / 10) < 1e-9);
});

test("do first: top three in the plan, with the reason", () => {
  const rows = [
    { id: "a", p: "Retention", score: 50, exp: 10, hrs: 1, inPlan: true },
    { id: "b", p: "Expansion", score: 90, exp: 10, hrs: 1, inPlan: true },
    { id: "c", p: "New Business", score: 99, exp: 10, hrs: 1, inPlan: false },
    { id: "d", p: "Bundle growth", score: 40, exp: 10, hrs: 1, inPlan: true },
    { id: "e", p: "Retention", score: 30, exp: 10, hrs: 1, inPlan: true },
  ];
  const f = doFirst(rows, { Retention: "behind", Expansion: "good" });
  assert.deepEqual(f.map(r => [r.id, r.why]), [["b", "best $ per hour"], ["a", "Retention is behind"], ["d", "best $ per hour"]]);
});

const opp = (o: Partial<Opp>): Opp =>
  ({ id: "x", name: "X", pillar: "Product Growth", status: "Committed", n: 10, value: 3650, cur: 0, tgt: 20, tgtEff: 20, clinicIds: ["1", "2"], ...o }) as Opp;

test("Growth link: committed work the plan already has is tagged, not added twice; the rest becomes actions", () => {
  const r = growthActions(
    [
      opp({ id: "at-risk", name: "Recover at-risk clinics", pillar: "Retention" }),
      opp({ id: "gut-stopped", name: "Gut Zoomer: stopped", n: 4, value: 365, tgtEff: 25, clinicIds: ["7", "8", "9", "10"] }),
      opp({ id: "providers", status: "Dropped" }), // dropped: left out
      opp({ id: "second-order", name: "Second order" }), // no matching action this week: becomes its own
      opp({ id: "state-gap", name: "States", status: "Validated", pillar: "Expansion" }), // not committed: suggested
    ],
    new Set(["atRisk", "callFirst", "lowAov"]),
  );
  assert.deepEqual(r.tags, { atRisk: { name: "Recover at-risk clinics", committed: true }, callFirst: { name: "Recover at-risk clinics", committed: true } });
  assert.deepEqual(r.extra.map(x => [x.id, x.committed]), [["growth:gut-stopped", true], ["growth:second-order", true], ["growth:state-gap", false]]);
  const g = r.extra[0];
  assert.equal(g.up, 4 * 365 * (7 / 365)); // 4 clinics x $365 a year, one week
  assert.equal(g.pr, 0.25);
  assert.deepEqual(g.ids, ["7", "8", "9", "10"]);
});

test("marginal fill: a clinic is counted once across actions; the plan's total equals the de-duplicated total", () => {
  const rows = [
    { id: "a", ids: ["1", "2"], exp: 200, hrs: 1 }, // 100 a clinic
    { id: "b", ids: ["2", "3"], exp: 160, hrs: 1 }, // 80 a clinic; clinic 2 already covered by a
    { id: "c", ids: ["9"], exp: 50, hrs: 1 },
    { id: "s", ids: ["4"], exp: 500, hrs: 1, defaultOut: true }, // Growth: suggested
  ];
  const f = marginalFill(rows, 3);
  const by = new Map(f.map(r => [r.id, r]));
  assert.deepEqual(f.filter(r => r.inPlan).map(r => r.id), ["a", "b", "c"]);
  assert.equal(by.get("b")!.mexp, 80); // only clinic 3
  assert.equal(by.get("b")!.overlap, 1);
  assert.equal(by.get("s")!.inPlan, false);
  const inPlan = f.filter(r => r.inPlan);
  assert.equal(inPlan.reduce((t, r) => t + r.mexp, 0), dedupedExpected(inPlan.map(r => ({ ...r, p: "x", pr: 0.5 }))).total);
  // Pinned in: a suggested action joins first; pinned out never.
  const g = marginalFill(rows.map(r => (r.id === "s" ? { ...r, pin: "in" as const } : r.id === "a" ? { ...r, pin: "out" as const } : r)), 3);
  assert.deepEqual(g.filter(r => r.inPlan).map(r => r.id), ["s", "b", "c"]);
});

test("action impact: in-plan = with minus without; out-of-plan = with it added", () => {
  const plan = [
    { id: "x", p: "Retention", ids: ["a", "b"], exp: 100, pr: 0.5 },
    { id: "z", p: "New Business", ids: ["c"], exp: 40, pr: 0.5 },
  ];
  const pace = { heading: 1000, plan: 1300, existingHeading: 900, existingPlan: 1100, newHeading: 100, newPlan: 200 };
  const cells = [{ label: "At-risk customers", ids: ["a", "b", "q"], now: 3 }];
  const a = actionImpact(plan, plan[0], pace, cells);
  assert.equal(a.inPlan, true);
  assert.equal(a.dollars, 100);
  assert.equal(a.dialsAfter[0].withPlan - a.dialsBefore[0].withPlan, 100); // existing business
  assert.equal(a.cellsBefore[0].after - a.cellsAfter[0].after, 1); // a and b at 50% each
  const out = actionImpact(plan, { id: "y", p: "Retention", ids: ["b", "d"], exp: 60, pr: 0.5 }, pace, cells);
  assert.equal(out.inPlan, false);
  assert.equal(out.dollars, 30); // b is already worth 50 in x; d adds 30
});

test("queue filters: pillar, high ROI (top third), source, in/out, behind pillars", () => {
  const rows = [
    { id: "1", p: "Retention", mscore: 900, inPlan: true, growthKind: null },
    { id: "2", p: "Retention", mscore: 300, inPlan: true, growthKind: "committed" as const },
    { id: "3", p: "Expansion", mscore: 600, inPlan: false, growthKind: "suggested" as const },
    { id: "4", p: "New Business", mscore: 100, inPlan: false, growthKind: null },
    { id: "5", p: "Product Growth", mscore: 50, inPlan: true, growthKind: null },
    { id: "6", p: "Expansion", mscore: 0, inPlan: false, growthKind: null },
  ];
  const st = { Retention: "behind", Expansion: "watch", "New Business": "good" };
  const ids = (f: Parameters<typeof filterQueue>[1]) => filterQueue(rows, f, st).map(r => r.id);
  assert.deepEqual(ids({ pillar: "Retention" }), ["1", "2"]);
  assert.deepEqual(ids({ highRoi: true }), ["1", "3"]); // 5 rows with a score: top ceil(5/3) = 2
  assert.deepEqual(ids({ source: "growth-suggested" }), ["3"]);
  assert.deepEqual(ids({ source: "scorecard" }), ["1", "4", "5", "6"]);
  assert.deepEqual(ids({ show: "out" }), ["3", "4", "6"]);
  assert.deepEqual(ids({ behind: true, show: "in" }), ["1", "2"]);
});

test("every Growth pillar is a week-plan pillar; same-work links point at real plan actions", () => {
  const plan = ["New Business", "Bundle growth", "Product Growth", "Retention", "Expansion"];
  for (const p of PILLARS) assert.ok(plan.includes(p), p);
  const actions = ["callFirst", "atRisk", "churned", "nearChurn", "secondOrder", "nurture", "returning", "lowAov", "followUp", "idle", "gap", "crosssell", "whitespace"];
  for (const list of Object.values(PLAN_ACTIONS_OF)) for (const a of list) assert.ok(actions.includes(a), a);
});

console.log(`${n} checks passed`);
