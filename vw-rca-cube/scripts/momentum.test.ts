// Offline checks for the momentum tile's anomaly consensus model (analytics/momentumModel.ts, METRIC_DEFINITIONS.md §8).
// Synthetic daily revenue with a known shape, so each detector's answer is known in advance. No Cube, no Convex.
//   node --import tsx scripts/momentum.test.ts
import assert from "node:assert/strict";
import { addDays, dow, eachDay } from "../analytics/dateUtils";
import { calendarEffect } from "../analytics/goalCurve";
import { drivers, momentum } from "../analytics/momentumModel";

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

test("a steady business is Normal, with every window near 0%", () => {
  const m = momentum(series(), AS_OF)!;
  assert.equal(m.weekEnd, "2026-11-08");
  assert.equal(m.weekly.length, 16);
  assert.equal(m.status, "normal");
  for (const w of m.windows) assert.equal(w.sig, 0, `${w.weeks}w ${w.pct}`);
  assert.equal(m.pattern, "steady");
});

test("holiday weeks (Thanksgiving, Christmas) don't trigger anything on their own", () => {
  const m2 = momentum(series(), "2026-01-11")!; // last complete week Jan 5–11, after Christmas and New Year
  assert.equal(m2.status, "normal");
  assert.equal(m2.windows[1].sig, 0);
});

test("one bad day is at most Watch", () => {
  const m = momentum(series(d => (d === "2026-11-06" ? 0.3 : 1)), AS_OF)!;
  assert.notEqual(m.status, "alert");
});

test("a new dip (last 5 weeks at −12%) is an Alert, pattern 'new'", () => {
  const m = momentum(series(d => (weeksBack(d) < 5 ? 0.88 : 1)), AS_OF)!;
  assert.equal(m.status, "alert");
  assert.equal(m.direction, -1);
  assert.match(m.pattern, /^new/);
  assert.ok(m.since && m.since >= "2026-09-28" && m.since <= "2026-10-12", `since ${m.since}`);
});

test("a sustained dip (last 20 weeks at −15%) is an Alert, pattern 'sustained'", () => {
  const m = momentum(series(d => (weeksBack(d) < 20 ? 0.85 : 1)), AS_OF)!;
  assert.equal(m.status, "alert");
  assert.equal(m.pattern, "sustained");
});

test("a slow slide (0% → −12% over 10 weeks) is caught: Watch or Alert, as a dip", () => {
  const m = momentum(series(d => { const w = weeksBack(d); return w < 10 ? 1 - 0.012 * (10 - w) : 1; }), AS_OF)!;
  assert.notEqual(m.status, "normal");
  assert.equal(m.direction, -1);
});

test("a rise mirrors a dip", () => {
  const m = momentum(series(d => (weeksBack(d) < 5 ? 1.12 : 1)), AS_OF)!;
  assert.equal(m.status, "alert");
  assert.equal(m.direction, 1);
});

test("a dip in weeks 5–8 that has recovered is not an Alert, pattern 'recovered'", () => {
  const m = momentum(series(d => { const w = weeksBack(d); return w >= 4 && w < 8 ? 0.85 : 1; }), AS_OF)!;
  assert.notEqual(m.status, "alert");
  assert.equal(m.pattern, "recovered");
});

test("drivers: gaps add up to the company gap, tagged sustained vs new", () => {
  const co = { a4: 900, l4: 1000, e4: 1000, a16: 3800, l16: 4000, e16: 4000 };
  const rows = [
    { key: "CA", label: "CA", a4: 400, l4: 500, a16: 1600, l16: 2000 }, // −20% on 4w, −20% on 16w: sustained
    { key: "AZ", label: "AZ", a4: 300, l4: 300, a16: 1200, l16: 1200 }, // flat
    { key: "CO", label: "CO", a4: 200, l4: 200, a16: 1000, l16: 800 },
  ];
  const ds = drivers(rows, co, 0, -1, 3);
  assert.equal(ds[0].key, "CA");
  assert.equal(ds[0].tag, "sustained");
  assert.equal(Math.round(ds.reduce((s, d) => s + d.gap, 0)), -100);
});

test("Christmas week can raise Watch at most, and says so", () => {
  const m = momentum(series(d => (d >= "2025-12-21" && d <= "2026-01-04" ? 0.6 : 1)), "2026-01-04")!;
  assert.equal(m.holidaySeason, true);
  assert.notEqual(m.status, "alert");
  assert.match(m.headline, /Holiday season/);
});

console.log(`${n} checks passed`);
