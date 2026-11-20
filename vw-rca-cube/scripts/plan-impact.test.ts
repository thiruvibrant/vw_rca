// Offline checks for the week plan's "If you follow this plan" preview (src/lib/planImpact.ts) and the Growth opportunity link
// (src/lib/planLink.ts). No Cube, no Convex.
//   npx tsx scripts/plan-impact.test.ts
import assert from "node:assert/strict";
import { cellImpact, dedupedExpected, dialImpact, doFirst } from "../src/lib/planImpact";
import { growthActions } from "../src/lib/planLink";
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
      opp({ id: "providers", status: "Validated" }), // not committed: left out
      opp({ id: "second-order", name: "Second order" }), // no matching action this week: becomes its own
    ],
    new Set(["atRisk", "callFirst", "lowAov"]),
  );
  assert.deepEqual(r.tags, { atRisk: "Recover at-risk clinics", callFirst: "Recover at-risk clinics" });
  assert.deepEqual(r.extra.map(x => x.id), ["growth:gut-stopped", "growth:second-order"]);
  const g = r.extra[0];
  assert.equal(g.up, 4 * 365 * (7 / 365)); // 4 clinics x $365 a year, one week
  assert.equal(g.pr, 0.25);
  assert.deepEqual(g.ids, ["7", "8", "9", "10"]);
});

console.log(`${n} checks passed`);
