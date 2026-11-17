import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSaved } from "../convex/growth.ts";
import { providerCandidates } from "../analytics/growth.ts";
import { annualFactor, baselineCandidates, overlapAdjusted, DEFAULT_WEIGHTS, discover, priority, recommendation, regionOf, regionSplit, resolve, revenueScore, topQuartile, type ClinicLite, type Inputs } from "../src/lib/growthOpps.ts";

const row = (clinic: string, o: Partial<ClinicLite> = {}): ClinicLite => ({ clinic, name: `C${clinic}`, state: "CA", sales: "R", actual: 100, expected: 100, baseline: 1000, orders: 5, aov: 300, daysSinceTouch: null, ...o });
const inputs = (): Inputs => ({
  windowDays: 182,
  book: { opp: { atRisk: { n: 2, up: 500, ids: ["1", "2"] }, lowAov: { n: 3, up: 3000, ids: ["1", "2", "3"] } }, kpi: { churned: 4, churnedIds: ["7", "8"], reactivatedCount: 1 } },
  rows: [row("1"), row("2"), row("3"), row("7", { baseline: 2000 }), row("8", { baseline: 4000 })],
  lapsed: [{ clinic: "9", orders: 3, gzRevenue: 6000, otherOrders: 1, lastOrder: "2025-09-01" }, { clinic: "10", orders: 1, gzRevenue: 2000, otherOrders: 0, lastOrder: "2025-02-01" }],
});

test("the annual factor scales a window to a year", () => {
  assert.equal(annualFactor(365), 1);
  assert.ok(Math.abs(annualFactor(182) - 2.0055) < 0.001);
});

test("at-risk is sized from the scorecard's own indicator, annualized, and low-AOV is replaced by baseline candidates", () => {
  const ds = discover(inputs());
  assert.equal(ds.some(d => d.id === "low-aov"), false);
  const risk = ds.find(d => d.id === "at-risk")!;
  assert.equal(risk.n, 2);
  assert.ok(Math.abs(risk.n * risk.value - 500 * annualFactor(182)) < 1e-6);
  assert.equal(risk.source, "scorecard");
  assert.equal(risk.pillar, "Retention");
});

/** Low-AOV clinics 1, 2, 3 and 5; clinic 4 is not low-AOV. Clinic 5 is on one of Thiru's lists. */
const withBaselines = (): Inputs => ({
  ...inputs(),
  book: { opp: { atRisk: { n: 2, up: 500, ids: ["1", "2"] }, lowAov: { n: 4, up: 3000, ids: ["1", "2", "3", "5"] }, nurture: { n: 4, up: 800, ids: ["1", "2", "6", "7"] } }, kpi: { churned: 4, churnedIds: ["7", "8"], reactivatedCount: 1 } },
  families: [
    { clinic: "1", win: { "Gut Zoomer": 2 } },
    { clinic: "2", win: { "Foundation Zoomer": 1, "Gut Zoomer": 2, "Non Zoomer": 9 } },
    { clinic: "3", win: { "Gut Zoomer": 3 } },
    { clinic: "4", win: { "Gut Zoomer": 1 } },
    { clinic: "5", win: { "Gut Zoomer": 1 } },
    { clinic: "20", win: { "Gut Zoomer": 4 } },
    { clinic: "21", win: { "Gut Zoomer": 6 } },
  ],
  gut: { asOf: "2026-11-10", lists: { refGzOrdersYear: 0, stopped: [], similar: [], lost: [], noGut: [{ clinic: "5", zoomers: [], hadGz: false }], newPatients: [], followUp: [] } },
  fz: { clinics: [
    { clinic: "1", products: [{ area: "Hormone", open: 1, low: 400, high: 500, likely: 100 }] },
    { clinic: "9", products: [{ area: "Hormone", open: 1, low: 400, high: 500, likely: 100 }] },
  ] },
});

test("baseline candidates: low-AOV clinics with 1 or 2 orders of a trial Zoomer, after Thiru's lists", () => {
  const c = baselineCandidates(withBaselines());
  assert.deepEqual(c.map(x => x.clinic), ["1", "2"]); // 3 has 3 orders, 4 is not low-AOV, 5 is on a Thiru list
  assert.deepEqual(c.map(x => [x.baseline, x.price, x.orders]), [["Gut Baseline", 460, 2], ["Gut Baseline", 460, 2]]);
});

test("a clinic with trials in two families is listed once, a tie goes Gut, Foundation, Hormone, and family keys ignore case", () => {
  const inp = withBaselines();
  inp.families = [{ clinic: "1", win: { "foundation zoomer": 1, "hormone zoomer": 1 } }, { clinic: "2", win: { "Hormone Zoomer": 2, "Foundation Zoomer": 1 } }];
  const c = baselineCandidates(inp);
  assert.deepEqual(c.map(x => [x.clinic, x.baseline, x.price]), [["1", "Foundation Baseline", 400], ["2", "Hormone Baseline", 420]]);
});

test("without Thiru's lists loaded there is no baseline row, and the other rows are untouched", () => {
  const inp = { ...withBaselines(), gut: null };
  const ds = discover(inp);
  assert.equal(ds.some(d => d.id === "baseline-candidates"), false);
  assert.equal(ds.find(d => d.id === "fz-targets")!.n, 2);
});

test("baseline sizing: price x the yearly orders of clinics that order the family 3+ times, 10% default, a family nobody buys 3+ times counts 0", () => {
  const d = discover(withBaselines()).find(x => x.id === "baseline-candidates")!;
  const A = annualFactor(182);
  const ref = ((4 + 6 + 3) / 3) * A; // clinics 20, 21 and 3 order Gut Zoomer 3+ times
  assert.ok(Math.abs(d.annual - 2 * 460 * ref) < 1e-6);
  assert.ok(Math.abs(d.n * d.value - d.annual) < 1e-6);
  assert.equal(d.tgt, 10);
  assert.equal(d.cur, 0);
  assert.equal(d.pillar, "Product Growth");
  const none = withBaselines();
  none.families = [{ clinic: "1", win: { "Hormone Zoomer": 1 } }];
  assert.equal(discover(none).find(x => x.id === "baseline-candidates")!.annual, 0);
});

test("a clinic claimed by baseline candidates is removed from the FZ rows and the nurture pool, and from nowhere else", () => {
  const ds = discover(withBaselines());
  const bl = new Set(ds.find(d => d.id === "baseline-candidates")!.clinicIds);
  assert.deepEqual([...bl].sort(), ["1", "2"]);
  for (const id of ["fz-targets", "gut-fz", "second-order"]) {
    const d = ds.find(x => x.id === id);
    if (d) for (const c of d.clinicIds) assert.equal(bl.has(c), false, `${id} still has ${c}`);
  }
  const nu = ds.find(d => d.id === "second-order")!;
  assert.equal(nu.n, 2);
  assert.ok(Math.abs(nu.value - (800 / 4) * annualFactor(182)) < 1e-6); // one order's value per clinic is unchanged
  assert.deepEqual(ds.find(d => d.id === "at-risk")!.clinicIds, ["1", "2"]); // recency rows are untouched
});

test("incremental revenue follows clinics × (target − current) × value, and the target is editable", () => {
  const d = discover(inputs()).find(x => x.id === "gz-lapsed")!;
  const base = resolve(d);
  assert.equal(base.incr, 2 * 0.15 * 4000);
  assert.equal(resolve(d, { tgt: 30 }).incr, 2 * 0.3 * 4000);
  assert.equal(base.source, "supporting");
});

test("reactivation uses the baseline of the churned clinics and the observed come-back rate", () => {
  const d = discover(inputs()).find(x => x.id === "reactivate")!;
  assert.equal(d.n, 2);
  assert.ok(Math.abs(d.cur - 20) < 1e-9); // 1 back of (1 back + 4 churned)
  assert.ok(Math.abs(d.value - 3000 * annualFactor(182)) < 1e-6);
  assert.equal(d.tgt, 30);
});

test("untouched counts only clinics with a touch date 45+ days old, in the top quartile by baseline", () => {
  const i = inputs();
  i.rows = [row("a", { baseline: 100, daysSinceTouch: 60 }), row("b", { baseline: 8000, daysSinceTouch: 60 }), row("c", { baseline: 6000, daysSinceTouch: null }), row("d", { baseline: 7000, daysSinceTouch: 10 }), row("e", { baseline: 9000, daysSinceTouch: 90 })];
  const d = discover(i).find(x => x.id === "untouched")!;
  assert.deepEqual([...d.clinicIds].sort(), ["b", "e"].sort());
});

test("state attainment takes the states furthest below goal", () => {
  const i = inputs();
  i.rows = [row("1", { state: "TX", expected: 500, actual: 100 }), row("2", { state: "FL", expected: 300, actual: 200 }), row("3", { state: "NY", expected: 100, actual: 300 })];
  const d = discover(i).find(x => x.id === "state-gap")!;
  assert.deepEqual([...d.clinicIds].sort(), ["1", "2"]);
  assert.ok(/TX/.test(d.segment));
});

test("scores, priority and the recommendation follow the weights as shares of their total", () => {
  const o = resolve(discover(inputs()).find(x => x.id === "gz-lapsed")!, { status: "Validated", fit: 5, time: 5, feas: 5, effort: 10 });
  assert.equal(o.scores.prob, 4);
  assert.equal(o.bucket, "Core growth");
  assert.ok(o.ret !== null && o.ret > 0);
  const p = priority(o, DEFAULT_WEIGHTS);
  assert.ok(Math.abs(p - priority(o, { rev: 60, prob: 50, fit: 30, time: 30, feas: 30 })) < 1e-9);
  assert.equal(recommendation(4), "Prioritize");
  assert.equal(recommendation(3.4), "Validate");
  assert.equal(recommendation(2), "Park");
  assert.equal(revenueScore(450_000), 5);
  assert.equal(revenueScore(10_000), 1);
});

test("regions: US states and countries, and an opportunity split across them", () => {
  assert.deepEqual(regionOf({ state: "ca", country: "US" }), { kind: "us", code: "CA" });
  assert.deepEqual(regionOf({ state: "ON", country: "CA" }), { kind: "intl", code: "CA" });
  const rows = [row("1", { state: "TX" }), row("2", { state: "TX" }), row("3", { state: "FL" })];
  const o = resolve({ ...discover(inputs()).find(x => x.id === "at-risk")!, clinicIds: ["1", "2", "3"], n: 3, value: 1000, cur: 0, tgt: 100 });
  const m = regionSplit(o, rows);
  assert.equal(m.get("us:TX"), 2000);
  assert.equal(m.get("us:FL"), 1000);
  assert.equal(topQuartile([1, 2, 3, 4]), 4);
});

test("saved edits keep only known fields in range", () => {
  assert.deepEqual(cleanSaved({ tgt: 150, effort: -5, fit: 9, status: "Nope", owner: "  Sales ", junk: 1 }), { tgt: 100, effort: 0, fit: 5, owner: "Sales" });
  assert.deepEqual(cleanSaved({ status: "Validated", note: "x" }), { status: "Validated", note: "x" });
});

test("overlap: a clinic in two opportunities counts once, at the larger share", () => {
  const d = discover(inputs());
  const a = resolve({ ...d.find(x => x.id === "gz-lapsed")!, clinicIds: ["1", "2"], n: 2, value: 1000, cur: 0, tgt: 100 }); // 1000 each
  const b = resolve({ ...d.find(x => x.id === "at-risk")!, clinicIds: ["2", "3"], n: 2, value: 3000, cur: 0, tgt: 100 }); // 3000 each
  assert.equal(overlapAdjusted([a, b]), 1000 + 3000 + 3000);
  assert.equal(a.incr + b.incr, 8000);
});

test("second order: stuck new clinics, valued at one order carried to a year", () => {
  const i = inputs();
  i.book!.opp.nurture = { n: 4, up: 1600, ids: ["1", "2", "3", "7"] };
  i.book!.kpi.ordersPerCustomer = 6;
  const d = discover(i).find(x => x.id === "second-order")!;
  assert.equal(d.n, 4);
  assert.ok(Math.abs(d.value - 400 * 6 * annualFactor(182)) < 1e-6);
  assert.equal(d.source, "supporting");
});

test("FZ targets: Gut on its own row, the other Zoomers on another, each from the open results", () => {
  const i = inputs();
  i.fz = {
    clinics: [
      { clinic: "1", products: [{ area: "Gut", open: 2, low: 920, high: 1100, likely: 300 }, { area: "Neural", open: 1, low: 450, high: 450, likely: 90 }] },
      { clinic: "2", products: [{ area: "Neural", open: 1, low: 450, high: 450, likely: 90 }] },
      { clinic: "3", products: [{ area: "Hormone", open: 0, low: 0, high: 0, likely: 0 }] },
    ],
  };
  const ds = discover(i);
  const gut = ds.find(x => x.id === "gut-fz")!;
  assert.deepEqual(gut.clinicIds, ["1"]);
  assert.equal(gut.source, "supporting");
  assert.ok(Math.abs(resolve(gut).incr - 300) < 1); // the default target rate is likely / low (to 0.1%), so the row matches the scorecard's likely revenue
  const other = ds.find(x => x.id === "fz-targets")!;
  assert.deepEqual(other.clinicIds, ["1", "2"]);
  assert.equal(other.source, "scorecard");
  assert.ok(Math.abs(resolve(other).incr - 180) < 1e-6);
  assert.equal(ds.find(x => x.id === "cross-sell"), undefined);
});

test("whitespace comes from the scorecard's own indicator", () => {
  const i = inputs();
  i.whitespace = { pairs: 6, ids: ["1", "2"], valuePerPair: 3000 };
  const ws = discover(i).find(x => x.id === "whitespace")!;
  assert.equal(ws.unit, "pairs");
  assert.equal(ws.clinicIds.length, 2);
  assert.equal(resolve(ws).incr, 6 * 0.12 * 3000);
  assert.equal(ws.ready, "partial");
});

test("a dropped opportunity gets the lowest probability score", () => {
  const d = discover(inputs()).find(x => x.id === "at-risk")!;
  assert.equal(resolve(d, { status: "Dropped" }).scores.prob, 1);
  assert.equal(resolve(d, { status: "Scaling" }).scores.prob, 5);
});

test("providers: clinics with 3+ providers in two years where 2+ stopped and the clinic still orders", () => {
  const all = [
    ...["a", "b", "c", "d"].map(p => ({ clinic: "1", provider: p, orders: 2, revenue: 1000 })),
    ...["a", "b"].map(p => ({ clinic: "2", provider: p, orders: 2, revenue: 500 })),
    ...["a", "b", "c"].map(p => ({ clinic: "3", provider: p, orders: 2, revenue: 500 })),
  ];
  const recent = [{ clinic: "1", provider: "a", orders: 1 }, { clinic: "3", provider: "a", orders: 1 }, { clinic: "3", provider: "b", orders: 1 }];
  const out = providerCandidates(all, recent);
  assert.deepEqual(out, [{ clinic: "1", providers: 4, active: 1, dormant: 3, dormantRevenue: 1500 }]);
  const d = discover({ ...inputs(), providers: out }).find(x => x.id === "providers")!;
  assert.equal(d.n, 1);
  assert.equal(d.value, 1500);
});

test("Thiru's gut lists become four opportunities with their own clinic-list columns", () => {
  const i = inputs();
  i.gut = {
    asOf: "2026-11-10",
    lists: {
      refGzOrdersYear: 30,
      stopped: [{ clinic: "1", gzA: 6, gzARev: 3000, daysSince: 150, otherOrders: 4 }, { clinic: "2", gzA: 5, gzARev: 1000, daysSince: 200, otherOrders: 0 }],
      similar: [{ clinic: "3", cred: "NP", peers: 8, peerScope: "zip", clinicRate: 0.05, peerRate: 0.39, orders: 100, gapRevenue: 20000 }],
      lost: [{ clinic: "7", gz25: 8, gz25Rev: 4000, fz: true }],
      noGut: [{ clinic: "8", zoomers: ["Hormone Zoomer"], hadGz: true }, { clinic: "9", zoomers: [], hadGz: false }],
    },
  };
  const ds = discover(i);
  const stopped = ds.find(x => x.id === "gut-stopped")!;
  assert.equal(stopped.n, 2);
  assert.equal(stopped.value, 6000); // mean of Mar–Jun revenue (3000, 1000) × 3
  assert.equal(stopped.cols?.[2].values["2"], 0);
  assert.equal(resolve(stopped).incr, 2 * 0.25 * 6000);
  assert.equal(ds.find(x => x.id === "gut-similar")!.value, 20000);
  assert.equal(ds.find(x => x.id === "gut-lost")!.cols?.[2].values["7"], 1);
  const gb = ds.find(x => x.id === "gut-baseline")!;
  assert.equal(gb.value, 30 * 460);
  assert.equal(gb.n, 2);
  assert.ok(ds.every(d => d.pillar === "Product Growth" || !d.id.startsWith("gut-")));
});

test("lists 2 and 6 become opportunities when the patient lists are present", () => {
  const i = inputs();
  i.gut = { asOf: "2026-11-10", lists: { refGzOrdersYear: 0, stopped: [], similar: [], lost: [], noGut: [], patients: true,
    newPatients: [{ clinic: "1", newA: 20, shareA: 0.6, newB: 10, shareB: 0.2 }],
    followUp: [{ clinic: "2", due: 6, overdue: 4 }, { clinic: "3", due: 5, overdue: 5 }] } };
  const ds = discover(i);
  const np = ds.find(x => x.id === "gut-newpat")!;
  assert.ok(Math.abs(np.value - 0.4 * 10 * 6 * 563) < 1e-6);
  const fu = ds.find(x => x.id === "gut-followup")!;
  assert.equal(fu.n, 2);
  assert.equal(fu.value, 10 * 460);
  assert.equal(fu.tgt, 9);
  assert.equal(ds.find(x => x.id === "gut-stopped"), undefined);
});

test("a clinic claimed by baseline candidates is also removed from the lapsed Gut Zoomer row and the whitespace row", () => {
  const inp = withBaselines();
  inp.families = [{ clinic: "1", win: { "Foundation Zoomer": 1 } }, { clinic: "2", win: { "Hormone Zoomer": 2 } }];
  inp.lapsed = [{ clinic: "1", orders: 3, gzRevenue: 6000, otherOrders: 1, lastOrder: "2025-09-01" }, { clinic: "9", orders: 3, gzRevenue: 2000, otherOrders: 0, lastOrder: "2025-02-01" }];
  inp.whitespace = { pairs: 4, ids: ["2", "9"], valuePerPair: 500 };
  const ds = discover(inp);
  assert.deepEqual(ds.find(d => d.id === "baseline-candidates")!.clinicIds, ["1", "2"]);
  assert.deepEqual(ds.find(d => d.id === "gz-lapsed")!.clinicIds, ["9"]);
  const ws = ds.find(d => d.id === "whitespace")!;
  assert.deepEqual(ws.clinicIds, ["9"]);
  assert.equal(ws.n, 2); // pairs scale with the clinics that remain (4 pairs over 2 clinics, 1 left)
  assert.equal(ws.annual, 2 * 500);
});
