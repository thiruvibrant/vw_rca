// Offline checks for METRIC_DEFINITIONS.md Appendix A (analytics/goalCurve.ts). No Cube, no Convex.
//   node --import tsx scripts/baseline-goal.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dow, eachDay } from "../analytics/dateUtils";
import {
  HOLIDAYS,
  baselineDays,
  bestWindow,
  calendarEffect,
  curveShareOver,
  dailyGoal,
  goalWeights,
  isWeekdayHoliday,
  lookbackOf,
} from "../analytics/goalCurve";
import { HOLIDAYS_CSV } from "../analytics/holidaysData";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

test("holidaysData.ts matches holidays.csv (the list shared with the emails)", () => {
  assert.equal(HOLIDAYS_CSV, fs.readFileSync(path.join(root, "analytics/holidays.csv"), "utf8"));
  assert.ok(HOLIDAYS.get("2026-11-26")?.name === "thanksgiving");
});

test("weekday holidays only", () => {
  assert.ok(isWeekdayHoliday("2026-11-26")); // Thursday
  assert.ok(!isWeekdayHoliday("2026-11-25"));
  assert.equal(calendarEffect("2026-12-25"), 0.03);
  assert.equal(calendarEffect("2026-12-23"), 1);
});

test("lookback = the 12 months before the reference date's quarter", () => {
  assert.deepEqual(lookbackOf("2026-11-08"), { start: "2025-10-01", end: "2026-09-30" });
  assert.deepEqual(lookbackOf("2027-01-15"), { start: "2026-01-01", end: "2026-12-31" });
});

// Synthetic company: weekdays 100, weekends 10, with a strong 91-day stretch in Mar-May 2026 (x1.5).
const rev = new Map<string, number>();
for (const d of eachDay("2024-12-01", "2026-11-08")) {
  const base = dow(d) === 0 || dow(d) === 6 ? 10 : 100;
  rev.set(d, d >= "2026-03-02" && d <= "2026-05-31" ? base * 1.5 : base);
}

test("best window = the highest 91 consecutive days inside the lookback", () => {
  const w = bestWindow(rev, "2026-11-08")!;
  assert.equal(addDays(w.start, 90), w.end);
  assert.ok(w.start >= "2026-03-02" && w.end <= "2026-05-31", `${w.start}..${w.end}`);
});

test("holidays are excluded and outliers capped at 2x the weekday median", () => {
  const r2 = new Map(rev);
  r2.set("2026-03-11", 1500); // a Wednesday bulk day: 10x normal
  const bd = baselineDays(r2, "2026-03-02", "2026-05-31");
  assert.equal(bd.capped.length, 1);
  assert.ok(Math.abs(bd.weight["2026-03-11"] * 1500 - 2 * 150) < 1e-9);
  const withHol = baselineDays(rev, "2026-05-01", "2026-07-30"); // Memorial Day (May 25) and Jul 3 (observed Independence)
  assert.deepEqual(withHol.excluded, ["2026-05-25", "2026-06-19", "2026-07-03"]);
  assert.equal(withHol.weight["2026-05-25"], 0);
  assert.equal(withHol.counts.reduce((a, b) => a + b, 0), 91 - 3);
});

test("goal weights: normal level x this year's holiday factor; daily goals sum to the target", () => {
  const w = goalWeights(rev, 2026);
  // Christmas 2026 is a Friday (2025: Thursday): the weight is a normal Friday x 0.03, not last year's Thursday dip.
  assert.ok(Math.abs(w.get("2026-12-25")! - 100 * 0.03) < 1e-9);
  // The day that was Christmas last year (Fri 2026-12-26 has ly = Fri 2025-12-27; check a Thursday 2026-12-24 = Christmas Eve).
  assert.ok(Math.abs(w.get("2026-12-24")! - 100 * HOLIDAYS.get("2026-12-24")!.factor) < 1e-9);
  const g = dailyGoal({ weights: w, year: 2026, target: 130e6, newSlice: 9.4e6, newPhasing: Array(12).fill(1 / 12) });
  let total = 0;
  for (const v of g.values()) total += v.existing + v.newBiz;
  assert.ok(Math.abs(total - 130e6) < 1, `total ${total}`);
  const nov = eachDay("2026-11-01", "2026-11-30");
  assert.ok(curveShareOver(w, nov) > 0 && curveShareOver(w, nov) < 1);
});

console.log(`\n${n} checks passed`);
