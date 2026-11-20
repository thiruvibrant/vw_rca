// Offline checks for clinic labels per window (analytics/clinicLabels.ts): the monthly Top 20% list, the label as of a
// window's end, which dates a window compares, and the direction of a move. No Cube, no Convex.
//   node --import tsx scripts/clinic-labels.test.ts
import assert from "node:assert/strict";
import { decodeLabel, encodeLabel, flowGroupOf, lapsingAt, flowsOf, labelAtOr, labelDateOf, labelDates, labelDateSpan, labelOf, labelsFor, lifeIn, moveOf, onListOf, pastLabelDates, revenueMonthsFor, standingIn, tierLists, windowDates } from "../analytics/clinicLabels";
import { cohortHistoryRows } from "../analytics/cohortHistory";
import { topCohortAtRisk } from "../analytics/callFirst";
import { isAtRisk, isLateByRhythm } from "../analytics/atRisk";

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

/** Revenue by month for clinics "1".."10": clinic k earns k*100 a month; clinic "11" only from Oct 2026. */
function revenue(): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const row = new Map<string, number>();
      for (let k = 1; k <= 10; k++) row.set(String(k), k * 100);
      if (key >= "2026-10") row.set("11", 50_000);
      out.set(key, row);
    }
  }
  return out;
}

test("the list for a month ranks the 12 months before it; top 20% by count, rounded up", () => {
  const lists = tierLists(revenue(), ["2026-10", "2026-11"]);
  const oct = lists.get("2026-10")!;
  assert.equal(oct.count, 10);
  assert.deepEqual([...oct.top].sort(), ["10", "9"]);
  assert.equal(oct.line, 9 * 100 * 12);
  assert.equal(oct.rank.get("10"), 1);
  // clinic 11 starts in October: on November's list (Oct revenue counted), not October's
  const nov = lists.get("2026-11")!;
  assert.equal(nov.count, 11);
  assert.ok(nov.top.has("11") && !oct.top.has("11"));
  assert.equal(nov.top.size, 3); // ceil(11 x 0.2)
});

test("revenue months: the 12 before each list month", () => {
  assert.deepEqual(revenueMonthsFor(["2026-02"]), [
    "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
  ]);
});

test("label: lifecycle first, then the list", () => {
  assert.equal(labelOf({ isNew: false, life: "churned" }, true), "churned");
  assert.equal(labelOf({ isNew: true, life: "reactivated" }, true), "reactivated");
  assert.equal(labelOf({ isNew: true, life: "active" }, true), "new");
  assert.equal(labelOf({ isNew: false, life: "active" }, true), "retained_top20");
  assert.equal(labelOf({ isNew: false, life: "active" }, false), "retained_rest");
});

test("label dates: month-ends for the last 12 months (or from 3 months before the window), then its end", () => {
  assert.deepEqual(labelDates("2026-05-01", "2026-11-12"), [
    "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30",
    "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-12",
  ]);
  assert.equal(labelDates("2025-06-01", "2026-11-12")[0], "2025-03-31");
});

test("window dates: month vs month before, quarter vs quarter before, weeks by their month, open windows capped", () => {
  const end = "2026-11-12";
  assert.deepEqual(windowDates("m:2026-11", "2026-11-12", end), { at: "2026-11-12", before: "2026-10-31" });
  assert.deepEqual(windowDates("m:2026-10", "2026-10-31", end), { at: "2026-10-31", before: "2026-09-30" });
  assert.deepEqual(windowDates("q:2026-Q4", "2026-11-12", end), { at: "2026-11-12", before: "2026-09-30" });
  assert.deepEqual(windowDates("q:2026-Q2", "2026-06-30", end), { at: "2026-06-30", before: "2026-03-31" });
  assert.deepEqual(windowDates("w:2026-10-12", "2026-10-18", end), { at: "2026-10-31", before: "2026-09-30" });
  assert.deepEqual(windowDates("all", "2026-11-12", end), { at: "2026-11-12", before: null });
});

test("labels per date: a clinic that stops ordering drops to churned; none before its first order", () => {
  const lists = tierLists(revenue(), ["2026-09", "2026-10", "2026-11"]);
  const days: string[] = [];
  for (let d = Date.parse("2025-06-02T00:00:00Z"); d <= Date.parse("2026-09-25T00:00:00Z"); d += 7 * 864e5) days.push(new Date(d).toISOString().slice(0, 10));
  const lab = labelsFor(
    { clinic: "10", firstOrder: "2025-06-02", orderDates: days, hasBaselineRevenue: true, hasWindowRevenue: true, priorRevenue: 1 },
    ["2025-05-31", "2026-09-30", "2026-11-12"],
    lists,
  );
  assert.equal(lab["2025-05-31"], undefined);
  assert.equal(decodeLabel(lab["2026-09-30"]), "retained_top20");
  assert.equal(decodeLabel(lab["2026-11-12"]), "churned"); // 48 days since its last order (weekly orderer)
});

test("codes: upper case = on the Top 20% list whatever the lifecycle; old lower-case snapshots still read", () => {
  assert.equal(encodeLabel("retained_top20"), "T");
  assert.equal(encodeLabel("churned", true), "C");
  assert.equal(encodeLabel("churned", false), "c");
  assert.equal(encodeLabel("retained_rest"), "r");
  assert.equal(decodeLabel("C"), "churned");
  assert.equal(decodeLabel("T"), "retained_top20");
  assert.equal(onListOf("C"), true);
  assert.equal(onListOf("N"), true);
  assert.equal(onListOf("c"), false);
  assert.equal(onListOf("t"), true); // pre-2026-11-16 snapshot
  assert.equal(onListOf("r"), false);
  assert.equal(onListOf(undefined), false);
  // The clinic in the test above is on the list at Sep 30 (still ordering) -> "T".
  const lists = tierLists(revenue(), ["2026-09"]);
  const lab = labelsFor(
    { clinic: "10", firstOrder: "2025-06-02", orderDates: ["2025-06-02", "2026-09-20"], hasBaselineRevenue: true, hasWindowRevenue: true, priorRevenue: 1 },
    ["2026-09-30"],
    lists,
  );
  assert.equal(onListOf(lab["2026-09-30"]), lists.get("2026-09")!.top.has("10"));
});

test("standing in a window: on the list, label now and before, move", () => {
  const labelAt = { "2026-09-30": "T", "2026-10-31": "T", "2026-11-15": "C" };
  assert.deepEqual(standingIn(labelAt, { at: "2026-11-15", before: "2026-10-31" }), {
    onList: true, cohort: "churned", prevCohort: "retained_top20", move: "down",
  });
  assert.deepEqual(standingIn(labelAt, { at: "2026-10-31", before: "2026-09-30" }), {
    onList: true, cohort: "retained_top20", prevCohort: "retained_top20", move: null,
  });
  // No code at the date (first order later): not on the list.
  assert.equal(standingIn(labelAt, { at: "2025-12-31", before: null })!.onList, false);
  // Older snapshot without codes: null, so the caller keeps its own flag.
  assert.equal(standingIn(undefined, { at: "2026-11-15", before: null }), null);
  assert.equal(standingIn({}, { at: "2026-11-15", before: null }), null);
});

test("moves: up, down, neutral", () => {
  assert.equal(moveOf("retained_rest", "retained_top20"), "up");
  assert.equal(moveOf("retained_top20", "retained_rest"), "down");
  assert.equal(moveOf("retained_top20", "churned"), "down");
  assert.equal(moveOf("churned", "reactivated"), "up");
  assert.equal(moveOf("new", "retained_rest"), "neutral");
  assert.equal(moveOf("reactivated", "retained_top20"), "neutral");
  assert.equal(moveOf("retained_rest", "retained_rest"), null);
  assert.equal(moveOf(undefined, "new"), null);
});

test("past windows: month-ends before the data end, and the days each one covers", () => {
  assert.deepEqual(pastLabelDates("2026-05-01", "2026-11-19"), ["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31"]);
  assert.deepEqual(pastLabelDates("2026-05-01", "2026-05-31"), []);
  assert.deepEqual(labelDateSpan("2026-10-31"), { start: "2026-09-25", end: "2026-10-31" }); // month, from 6 days before
  assert.deepEqual(labelDateSpan("2026-09-30"), { start: "2026-07-01", end: "2026-09-30" }); // quarter end: the whole quarter
  // Every past window's label date is one of them, and its days fall in that date's span.
  const end = "2026-11-19";
  for (const [id, last] of [["m:2026-10", "2026-10-31"], ["q:2026-Q3", "2026-09-30"], ["w:2026-10-27", "2026-11-02"], ["w:2026-09-29", "2026-10-05"], ["d:2026-10-01", "2026-10-01"]]) {
    const at = windowDates(id, last, end).at;
    assert.equal(labelDateOf(id, end), at, id);
    if (at !== end) assert.ok(pastLabelDates("2026-05-01", end).includes(at), id);
  }
  assert.equal(labelDateOf("w:2026-11-16", end), end); // this week: current
  assert.equal(labelDateOf("all", end), end);
});

test("tree = list: regrouping clinics by the label at a past date gives the same sums as the per-clinic rows", () => {
  const clinics = [
    { id: "1", labelAt: { "2026-10-31": "T" }, cohort: "churned", rev: 100 },
    { id: "2", labelAt: { "2026-10-31": "r" }, cohort: "retained_rest", rev: 40 },
    { id: "3", labelAt: { "2026-10-31": "C" }, cohort: "retained_top20", rev: 0 },
    { id: "4", labelAt: {}, cohort: "new", rev: 25 }, // first order after Oct 31: falls back, as the list does
  ];
  const tree = new Map<string, number>();
  for (const c of clinics) {
    const k = labelAtOr(c.labelAt, "2026-10-31", c.cohort);
    tree.set(k, (tree.get(k) ?? 0) + c.rev);
  }
  assert.deepEqual(Object.fromEntries(tree), { retained_top20: 100, retained_rest: 40, churned: 0, new: 25 });
});

test("lifecycle per window: today's status now, the label then for a past window", () => {
  const labelAt = { "2026-10-31": "C", "2026-11-19": "T" };
  assert.equal(lifeIn(labelAt, "active", "2026-11-19", "2026-11-19"), "active");
  assert.equal(lifeIn(labelAt, "active", "2026-10-31", "2026-11-19"), "churned");
  assert.equal(lifeIn({ "2026-10-31": "a" }, "churned", "2026-10-31", "2026-11-19"), "reactivated");
  assert.equal(lifeIn({ "2026-10-31": "n" }, "churned", "2026-10-31", "2026-11-19"), "active");
  assert.equal(lifeIn(undefined, "churned", "2026-10-31", "2026-11-19"), "churned"); // older snapshot
});

test("Call-first chip: today's Top 20% label, not a past tab's", () => {
  const atRisk = new Set(["1", "2"]);
  // On a past tab clinic 1 read Active - rest then but is on today's list; clinic 2 the other way round.
  const rows = [{ clinic: "1", cohort: "retained_rest", cohortNow: "retained_top20" }, { clinic: "2", cohort: "retained_top20", cohortNow: "retained_rest" }];
  assert.deepEqual([...topCohortAtRisk(rows.map(r => ({ clinic: r.clinic, cohort: r.cohortNow ?? r.cohort })), atRisk)], ["1"]);
});

test("cohort movement: four groups that follow the moves, first labels, bounce-backs, revenue by the right month", () => {
  const D = ["2026-08-31", "2026-09-30", "2026-10-31", "2026-11-19"];
  const clinics = [
    { clinic: "up", labelAt: { "2026-08-31": "r", "2026-09-30": "T", "2026-10-31": "T", "2026-11-19": "T" } },
    { clinic: "down", labelAt: { "2026-08-31": "T", "2026-09-30": "r", "2026-10-31": "r", "2026-11-19": "r" } },
    { clinic: "flip", labelAt: { "2026-08-31": "r", "2026-09-30": "c", "2026-10-31": "r", "2026-11-19": "c" } },
    { clinic: "gone", labelAt: { "2026-08-31": "T", "2026-09-30": "C", "2026-10-31": "c", "2026-11-19": "c" } },
    { clinic: "newbie", labelAt: { "2026-10-31": "n", "2026-11-19": "N" } },
    { clinic: "same", labelAt: { "2026-08-31": "r", "2026-09-30": "r", "2026-10-31": "r", "2026-11-19": "r" } },
  ];
  const rev = (c: string, m: string) => ({ "up|2026-09": 900, "down|2026-08": 700, "flip|2026-08": 50, "gone|2026-08": 4000, "flip|2026-10": 60 } as Record<string, number>)[`${c}|${m}`] ?? 0;
  const [sep, oct, nov] = flowsOf(clinics, D, rev);
  assert.deepEqual([sep.from, sep.to], ["2026-08-31", "2026-09-30"]);
  assert.equal(sep.labelled, 5);
  assert.deepEqual(sep.groups, { up: { n: 1, rev: 900 }, down: { n: 1, rev: 700 }, back: { n: 0, rev: 0 }, churn: { n: 2, rev: 4050 } });
  assert.equal(sep.bounced, 1); // "flip" is back at Oct 31; "gone" is not
  assert.deepEqual(oct.groups.back, { n: 1, rev: 60 }); // revenue in the month it came back
  assert.equal(oct.first, 1);
  assert.equal(nov.groups.churn.n, 1);
  assert.equal(nov.bounced, 0); // nothing after it yet
  // Every group agrees with the clinic card's arrow.
  for (const c of clinics)
    for (let i = 1; i < D.length; i++) {
      const a = decodeLabel(c.labelAt[D[i - 1] as keyof typeof c.labelAt]), b = decodeLabel(c.labelAt[D[i] as keyof typeof c.labelAt]);
      const g = flowGroupOf(a, b);
      if (g) assert.equal(moveOf(a, b), g === "up" || g === "back" ? "up" : "down");
    }
});

test("cohort history: clinics outside the rebuild are labelled from their orders; revenue by month; owners", () => {
  const lists = tierLists(revenue(), ["2026-10", "2026-11"]);
  const monthRev = new Map([["2026-10", new Map([["10", 1000], ["99", 0]])], ["2026-09", new Map([["77", 300]])]]);
  const rows = cohortHistoryRows({
    labelDays: ["2026-09-30", "2026-10-31", "2026-11-12"],
    lists,
    monthRev,
    current: { month: "2026-11", rev: new Map([["10", 250]]) },
    labelAtOf: new Map([["10", { "2026-10-31": "T", "2026-11-12": "T" }]]),
    firstOrderOf: new Map([["77", "2026-01-05"]]),
    orderDatesOf: new Map([["77", ["2026-01-05", "2026-09-10"]]]),
    priorRevOf: () => 0,
    identityOf: c => (c === "10" ? { name: "Ten", sales: "Rep A", teamLead: "Lead" } : undefined),
  });
  const by = new Map(rows.map(r => [r.clinic, r]));
  assert.deepEqual(by.get("10")!.rev, { "2026-10": 1000, "2026-11": 250 });
  assert.equal(by.get("10")!.sales, "Rep A");
  // Clinic 77 is outside the rebuild (no baseline or window revenue): labelled with the same rules, reactivated at Sep 30
  // (back after an 8-month gap), churned by Nov 12.
  assert.equal(decodeLabel(by.get("77")!.labelAt["2026-09-30"]), "reactivated");
  assert.equal(decodeLabel(by.get("77")!.labelAt["2026-11-12"]), "churned");
  assert.equal(by.get("77")!.sales, "—");
  assert.ok(!by.has("99")); // no revenue, not in the rebuild: left out
});

test("lapsing: late against the clinic's own rhythm, as of a date; needs a rhythm and 5+ days", () => {
  // Orders every 3 days (a Top 20% clinic's pattern), then silent. Median gap 2 business days -> late line max(1.5 x 2, ...) = 3 business days.
  const dates: string[] = [];
  for (let d = Date.parse("2026-08-03T00:00:00Z"); d <= Date.parse("2026-09-25T00:00:00Z"); d += 3 * 864e5) dates.push(new Date(d).toISOString().slice(0, 10));
  const last = dates[dates.length - 1];
  assert.equal(lapsingAt(dates, last), false); // just ordered
  assert.equal(lapsingAt(dates, "2026-09-28"), false); // under 5 days, even if over the late line
  assert.equal(lapsingAt(dates, "2026-10-17"), true); // about 3 weeks silent: lapsing, and well short of the 45-day churn line
  assert.equal(lapsingAt(dates.slice(0, 2), "2026-10-17"), false); // no rhythm under 3 order dates
  assert.equal(lapsingAt(dates, "2026-09-20"), false); // order dates after the cutoff are ignored
  // A slow buyer (every ~40 days) is not lapsing at day 22.
  const slow = ["2026-01-05", "2026-02-14", "2026-03-26", "2026-05-05", "2026-06-14"];
  assert.equal(lapsingAt(slow, "2026-07-06"), false);
  // labelOf: lifecycle first, then lapsing, then the list; the upper-case code keeps the list membership.
  assert.equal(labelOf({ isNew: false, life: "active" }, true, true), "lapsing");
  assert.equal(labelOf({ isNew: false, life: "churned" }, true, true), "churned");
  assert.equal(labelOf({ isNew: true, life: "active" }, true, true), "new");
  assert.equal(encodeLabel("lapsing", true), "L");
  assert.equal(onListOf("L"), true);
  assert.equal(decodeLabel("L"), "lapsing");
  assert.equal(decodeLabel("l"), "lapsing");
  assert.equal(moveOf("retained_top20", "lapsing"), "neutral"); // a warning, not a move
  assert.equal(moveOf("lapsing", "churned"), "down");
  assert.equal(moveOf("churned", "lapsing"), "up");
});

test("lapsing and At-risk: the card is Lapsing plus a real shortfall, and a churned clinic is neither", () => {
  assert.equal(isLateByRhythm(2, undefined, 3), false);
  assert.equal(isLateByRhythm(2, undefined, 4), true);
  assert.equal(isLateByRhythm(2, 20, 15), false); // its own p90 gap widens the line
  const base = { life: "active", daysSinceLast: 22, medianGapBd: 2, bdSinceLastOrder: 16, baseline: 1000, realChange: -300, health: [] as string[] };
  assert.equal(isAtRisk(base), true);
  assert.equal(isAtRisk({ ...base, realChange: -50 }), false); // late but short of the 10% shortfall: Lapsing only
  assert.equal(isAtRisk({ ...base, life: "churned" }), false);
  // Call-first chip: a Lapsing clinic on the list counts as a top clinic.
  const rows = [
    { clinic: "1", cohort: "lapsing", onList: true },
    { clinic: "2", cohort: "lapsing", onList: false },
    { clinic: "3", cohort: "retained_top20" },
  ];
  assert.deepEqual([...topCohortAtRisk(rows, new Set(["1", "2", "3"]))].sort(), ["1", "3"]);
});

console.log(`${n} checks passed`);
