// Offline checks for clinic labels per window (analytics/clinicLabels.ts): the monthly Top 20% list, the label as of a
// window's end, which dates a window compares, and the direction of a move. No Cube, no Convex.
//   node --import tsx scripts/clinic-labels.test.ts
import assert from "node:assert/strict";
import { decodeLabel, encodeLabel, labelDates, labelOf, labelsFor, moveOf, onListOf, revenueMonthsFor, standingIn, tierLists, windowDates } from "../analytics/clinicLabels";

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

console.log(`${n} checks passed`);
