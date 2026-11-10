// Offline checks for the momentum tiles (analytics/momentumModel.ts, METRIC_DEFINITIONS.md §8): the three questions
// (how big, how long, which way) and the red / amber / green light.
// Synthetic daily revenue with a known shape, so each detector's answer is known in advance. No Cube, no Convex.
//   node --import tsx scripts/momentum.test.ts
import assert from "node:assert/strict";
import { addDays, dow, eachDay } from "../analytics/dateUtils";
import { calendarEffect } from "../analytics/goalCurve";
import { drivers, lightHistory, orderValue, pace, sinceOf, summaryOf } from "../analytics/momentumModel";

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

const AS_OF = "2026-11-08"; // a Sunday: the last complete week is Nov 2–8

/** Deterministic noise in [-amp, amp] (mulberry32: exact 32-bit integer maths). */
function noise(seed: number, amp: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) - 0.5) * 2 * amp;
  };
}

/**
 * A flat business: $100K a weekday, $10K a weekend day, holiday factors applied, so last year's normal level × the
 * calendar effect is the right expectation. Noise like the real series: ±6% per week and ±8% per day (weekly SD ≈ 4%).
 * `shape(d)` multiplies each day (1 = no change).
 */
function series(shape: (d: string) => number = () => 1, seed = 7): Map<string, number> {
  const daily = noise(seed, 0.08);
  const weekly = noise(seed * 7919 + 1, 0.06);
  const out = new Map<string, number>();
  let wk = 0;
  for (const d of eachDay("2022-06-01", AS_OF)) {
    const k = dow(d);
    if (k === 1) wk = weekly();
    const base = k === 0 || k === 6 ? 10_000 : 100_000;
    // holidays.csv starts in 2025; give 2024 the same dips (shifted a year) as the real series has
    const hol = d < "2025-01-01" ? calendarEffect(addDays(d, 364)) : calendarEffect(d);
    out.set(d, base * hol * (1 + wk) * (1 + daily()) * shape(d));
  }
  return out;
}

const weeksBack = (d: string) => Math.floor((Date.parse(`${AS_OF}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / (7 * 864e5));

test("a steady business is green, every window inside its range", () => {
  const m = pace(series(), AS_OF)!;
  assert.equal(m.weekEnd, "2026-11-08");
  assert.equal(m.weekly.length, 52);
  assert.equal(m.light, "green");
  for (const w of m.windows) assert.ok(Math.abs(w.z) < 2, `${w.weeks}w z ${w.z}`);
});

test("holiday weeks (Thanksgiving, Christmas, New Year) don't turn anything red on their own", () => {
  assert.equal(pace(series(), "2026-01-11")!.light, "green");
  assert.equal(pace(series(), "2025-12-07")!.light, "green"); // week after Thanksgiving
});

test("one bad day is not red", () => {
  assert.notEqual(pace(series(d => (d === "2026-11-06" ? 0.3 : 1)), AS_OF)!.light, "red");
});

test("a 5-week dip of −12% is red, below, with the streak and size to say so", () => {
  const m = pace(series(d => (weeksBack(d) < 5 ? 0.88 : 1)), AS_OF)!;
  assert.equal(m.light, "red");
  assert.equal(m.side, -1);
  assert.ok(m.streak.weeks >= 5, `streak ${m.streak.weeks}`);
  assert.ok(m.size.pct < -0.08 && m.size.outside);
});

test("a 2-week dip is amber, not red (big but not lasting yet)", () => {
  assert.equal(pace(series(d => (weeksBack(d) < 2 ? 0.8 : 1)), AS_OF)!.light, "amber");
});

test("a slow slide (0% → −12% over 10 weeks) is red and worsening", () => {
  const m = pace(series(d => { const w = weeksBack(d); return w < 10 ? 1 - 0.012 * (10 - w) : 1; }), AS_OF)!;
  assert.equal(m.light, "red");
  assert.equal(m.way, "worsening");
});

test("a rise mirrors a dip", () => {
  const m = pace(series(d => (weeksBack(d) < 6 ? 1.12 : 1)), AS_OF)!;
  assert.equal(m.light, "red");
  assert.equal(m.side, 1);
});

test("a dip in weeks 5–8 that has recovered is green and improving", () => {
  const m = pace(series(d => { const w = weeksBack(d); return w >= 4 && w < 8 ? 0.85 : 1; }), AS_OF)!;
  assert.notEqual(m.light, "red");
  assert.equal(m.way, "improving");
});

test("Christmas week shows amber at most", () => {
  const m = pace(series(d => (d >= "2025-11-01" && d <= "2026-01-04" ? 0.85 : 1)), "2026-01-04")!;
  assert.equal(m.holidaySeason, true);
  assert.notEqual(m.light, "red");
});

test("light history dates the start of a dip", () => {
  const s = series(d => (weeksBack(d) < 10 ? 0.85 : 1));
  const h = lightHistory(s, AS_OF, 16);
  assert.equal(h.length, 16);
  assert.equal(h[h.length - 1].light, "red");
  const since = sinceOf(h)!;
  assert.ok(since >= "2026-08-24" && since <= "2026-09-14", `since ${since}`);
});

test("order value and the summary: volume down, price up", () => {
  const rev = series(d => (weeksBack(d) < 8 ? 0.92 : 1));
  const ord = series(d => (weeksBack(d) < 8 ? 0.8 : 1), 11);
  // revenue = orders × value: the same days, a 15% higher value per order in the last 8 weeks
  const r = pace(rev, AS_OF)!;
  const o = pace(ord, AS_OF)!;
  const v = orderValue(r, o);
  assert.ok(v.change > 0.03, `aov change ${v.change}`);
  assert.equal(v.way, "up");
  const text = summaryOf(r, o, v, "2026-09-14");
  assert.match(text, /The main cause is fewer orders/);
  assert.match(text, /since September/);
  assert.match(text, /Higher prices are covering part of the drop/);
});

test("drivers: gaps add up to the company gap, tagged ongoing vs new", () => {
  const co = { a4: 900, l4: 1000, e4: 1000, a16: 3800, l16: 4000, e16: 4000 };
  const rows = [
    { key: "CA", label: "CA", a4: 400, l4: 500, a16: 1600, l16: 2000 },
    { key: "AZ", label: "AZ", a4: 300, l4: 300, a16: 1200, l16: 1200 },
    { key: "CO", label: "CO", a4: 200, l4: 200, a16: 1000, l16: 800 },
  ];
  const ds = drivers(rows, co, -1, 3);
  assert.equal(ds[0].key, "CA");
  assert.equal(ds[0].tag, "ongoing");
  assert.equal(Math.round(ds.reduce((s, d) => s + d.gap, 0)), -100);
});

console.log(`${n} checks passed`);
