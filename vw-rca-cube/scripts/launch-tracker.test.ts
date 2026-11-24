// Offline checks for the new-product launch model (analytics/launchModel.ts): launch date, launch-age weeks, holiday weeks, the
// reference band, status, trend and dollars. No Cube, no Convex.
//   node --import tsx scripts/launch-tracker.test.ts
import assert from "node:assert/strict";
import { addDays } from "../analytics/dateUtils";
import { dollarsOf, holidayWeek, launchDateOf, launchWeeks, normalCompanyWeek, percentile, referenceBand, scoredWeeks, statusOf, trendOf, type Day } from "../analytics/launchModel";

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

/** A launch: `weekly` orders a week from `start`, spread evenly over its 7 days; revenue $500 an order. */
function series(start: string, weekly: number[]): Day[] {
  const out: Day[] = [];
  weekly.forEach((w, i) => {
    for (let k = 0; k < 7; k++) {
      const o = Math.floor(w / 7) + (k < w % 7 ? 1 : 0);
      if (o) out.push({ d: addDays(start, 7 * i + k), o, r: o * 500 });
    }
  });
  return out;
}
/** Weekly buckets for a series, as of the end of its last week (so no empty weeks after it). */
const lw = (start: string, weekly: number[], co: Map<string, number>) => launchWeeks(series(start, weekly), co, start, addDays(start, 7 * weekly.length - 1));
/** Company orders: `perDay` every day from `from` to `to`, with a holiday dip on Thanksgiving week 2026 (Nov 23-29). */
function company(from: string, to: string, perDay: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, d >= "2026-11-23" && d <= "2026-11-29" ? Math.round(perDay * 0.58) : perDay);
  return m;
}

test("launch date: the first day with an order and 3+ orders in its 7 days (a stray early order is not a launch)", () => {
  const days: Day[] = [{ d: "2026-09-17", o: 1, r: 500 }, ...series("2026-11-09", [14])];
  assert.equal(launchDateOf(days), "2026-11-09");
  assert.equal(launchDateOf([{ d: "2026-09-17", o: 1, r: 1 }]), null);
});

test("holiday weeks: Thanksgiving, Christmas and New Year's Eve weeks are flagged, a plain week is not", () => {
  assert.equal(holidayWeek("2026-11-23"), true); // Thanksgiving Nov 26
  assert.equal(holidayWeek("2026-12-21"), true); // Christmas
  assert.equal(holidayWeek("2026-12-28"), true); // New Year's Eve
  assert.equal(holidayWeek("2026-12-07"), false);
  assert.equal(holidayWeek("2026-11-16"), false);
});

test("launch-age weeks: week 1 starts on the launch date, the open week is not complete, attach = orders per 100 company orders", () => {
  const co = company("2026-10-01", "2026-12-31", 600);
  const w = launchWeeks(series("2026-11-02", [20, 28, 35]), co, "2026-11-02", "2026-11-19");
  assert.equal(w.length, 3);
  assert.deepEqual(w.map(x => x.complete), [true, true, false]);
  assert.equal(w[0].orders, 20);
  assert.equal(w[0].company, 4200);
  assert.ok(Math.abs(w[0].attach - (20 / 4200) * 100) < 1e-9);
});

test("percentile and band: needs 3 references at an age; holiday weeks and open weeks are left out", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  const co = company("2025-01-01", "2026-12-31", 600);
  const mk = (start: string, weekly: number[]) => lw(start, weekly, co);
  const refs = [mk("2026-01-05", [20, 30, 40]), mk("2026-02-02", [10, 20, 30]), mk("2026-03-02", [30, 40, 50])];
  const band = referenceBand(refs, 4);
  assert.equal(band[0]!.refs, 3);
  assert.ok(band[0]!.p25 < band[0]!.median && band[0]!.median < band[0]!.p75);
  assert.equal(band[3], null); // nobody has a week 4
  assert.equal(referenceBand(refs.slice(0, 1), 3)[0], null); // one reference: no band
  assert.equal(referenceBand(refs.slice(0, 2), 3)[0]!.refs, 2); // two are enough (few launches, and a holiday week drops one)
});

test("season-free: a launch that dips only because of Thanksgiving week is on track, though its raw volume looks behind", () => {
  const co = company("2025-01-01", "2026-12-31", 600);
  const ref = (start: string) => lw(start, [30, 30, 30, 30, 30, 30, 30, 30], co);
  const band = referenceBand([ref("2026-01-05"), ref("2026-02-02"), ref("2026-03-02")], 9);
  // The launch runs 30 a week at normal volume and 17 (-42%) in Thanksgiving week, like the company.
  const launch = "2026-10-26";
  const days = series(launch, [30, 30, 30, 30, 17, 30]);
  const weeks = launchWeeks(days, co, launch, "2026-12-06");
  assert.equal(weeks[4].holiday, true); // week of Nov 23
  assert.equal(weeks[4].complete, true);
  assert.ok(weeks[4].orders < 0.7 * weeks[3].orders); // raw volume down more than 30%
  assert.equal(scoredWeeks(weeks).some(w => w.n === 5), false); // the holiday week is not scored
  assert.equal(statusOf(weeks, band, "2026-12-06", launch), "on-track");
});

test("status: too early, ahead, behind; no band without 3 references", () => {
  const co = company("2025-01-01", "2026-12-31", 600);
  const refs = ["2026-01-05", "2026-02-02", "2026-03-02"].map(s => lw(s, [30, 30, 30, 30, 30, 30], co));
  const band = referenceBand(refs, 8);
  const at = (weekly: number[], asOf: string) => launchWeeks(series("2026-08-03", weekly), co, "2026-08-03", asOf);
  assert.equal(statusOf(at([5], "2026-08-09"), band, "2026-08-09", "2026-08-03"), "too-early"); // 7 days live
  assert.equal(statusOf(at([20, 20], "2026-08-16"), band, "2026-08-16", "2026-08-03"), "too-early"); // 40 orders but only 2 scored weeks
  const up = at([60, 60, 60, 60], "2026-08-30");
  assert.equal(statusOf(up, band, "2026-08-30", "2026-08-03"), "ahead");
  const dn = at([20, 20, 20, 20], "2026-08-30");
  assert.equal(statusOf(dn, band, "2026-08-30", "2026-08-03"), "behind");
  assert.equal(statusOf(up, band.map(() => null), "2026-08-30", "2026-08-03"), "no-band");
  assert.equal(statusOf(at([30, 30], "2026-12-30"), band, "2026-12-30", "2026-08-03"), "mature"); // over 98 days live: no longer a launch
});

test("trend: last 2 scored weeks vs the 2 before, season-free; null under 4 scored weeks", () => {
  const co = company("2025-01-01", "2026-12-31", 600);
  const w = launchWeeks(series("2026-08-03", [20, 20, 40, 40]), co, "2026-08-03", "2026-08-30");
  assert.equal(trendOf(w)!.trend, "rising");
  assert.equal(trendOf(launchWeeks(series("2026-08-03", [40, 40, 20, 20]), co, "2026-08-03", "2026-08-30"))!.trend, "falling");
  assert.equal(trendOf(launchWeeks(series("2026-08-03", [30, 30, 31, 31]), co, "2026-08-03", "2026-08-30"))!.trend, "steady");
  assert.equal(trendOf(lw("2026-08-03", [30, 30, 31], co)), null);
});

test("dollars: revenue so far, run rate of the last 2 scored weeks, potential at the reference median, upside never negative", () => {
  const co = company("2025-01-01", "2026-12-31", 600);
  const refs = ["2026-01-05", "2026-02-02", "2026-03-02"].map(s => lw(s, Array(14).fill(42), co));
  const band = referenceBand(refs, 14);
  const w = launchWeeks(series("2026-08-03", [10, 10, 10, 10]), co, "2026-08-03", "2026-08-30");
  const normal = normalCompanyWeek(co, "2026-08-30");
  assert.equal(normal, 4200);
  const d = dollarsOf(w, band, normal);
  assert.equal(d.revenue, 40 * 500);
  assert.equal(d.runRate, 10 * 500);
  assert.equal(d.perOrder, 500);
  assert.ok(Math.abs(d.potential! - 42 * 500) < 1e-6); // 42 orders on 4,200 = 1 per 100
  assert.ok(Math.abs(d.upside! - 32 * 500) < 1e-6);
  const above = dollarsOf(launchWeeks(series("2026-08-03", [60, 60, 60, 60]), co, "2026-08-03", "2026-08-30"), band, normal);
  assert.equal(above.upside, 0);
  assert.equal(dollarsOf(w, band.map(() => null), normal).potential, null);
});

console.log(`${n} checks passed`);
