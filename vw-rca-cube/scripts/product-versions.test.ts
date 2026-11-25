// Offline checks for test versions, relaunches and variants (analytics/versionModel.ts). No Cube, no Convex.
//   node --import tsx scripts/product-versions.test.ts
import assert from "node:assert/strict";
import { addDays } from "../analytics/dateUtils";
import type { Day } from "../analytics/launchModel";
import { healthOf, kindOf, readOf, startOf, versionEvents, versionLabel, type Version } from "../analytics/versionModel";

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

/** `weekly` orders a week from `start`, spread over the 7 days. */
function series(start: string, weekly: number[]): Day[] {
  const out: Day[] = [];
  weekly.forEach((w, i) => {
    for (let k = 0; k < 7; k++) {
      const o = Math.floor(w / 7) + (k < w % 7 ? 1 : 0);
      if (o) out.push({ d: addDays(start, 7 * i + k), o, r: 0 });
    }
  });
  return out;
}
const company = (from: string, to: string, perDay = 600) => {
  const m = new Map<string, number>();
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, perDay);
  return m;
};
const co = company("2025-01-01", "2026-12-31");
const asOf = "2026-12-20";

test("labels: what the raw name adds to the family's name", () => {
  assert.equal(versionLabel("Nutrient Baseline 2.0", "Nutrient Baseline"), "2.0");
  assert.equal(versionLabel("Foundation Baseline Male", "Foundation Baseline"), "Male");
  assert.equal(versionLabel("Gut Zoomer New York", "Gut Zoomer NY"), "New York");
  assert.equal(versionLabel("Food Zoomer (DBS)", "Food Zoomer DBS"), "DBS");
  assert.equal(versionLabel("Nutrient Baseline", "Nutrient Baseline"), "original");
});

test("start: the official date wins; otherwise one stray early order is not a start", () => {
  assert.deepEqual(startOf({ name: "Gut Zoomer New York", base: "Gut Zoomer NY", days: [{ d: "2026-06-02", o: 1, r: 0 }, ...series("2026-07-27", [8, 6, 1, 3, 22])] }), { start: "2026-08-24", official: true });
  assert.equal(startOf({ name: "Test X 2.0", base: "Test X", days: [{ d: "2026-05-06", o: 1, r: 0 }, ...series("2026-09-28", [150])] }).start, "2026-09-28");
});

// Nutrient-like: v1 ~21 a week, then 2.0 from Nov 9 and v1 stops.
const v1: Version = { name: "Test X", base: "Test X", days: [...series("2026-04-06", Array(31).fill(21)), ...series("2026-11-09", [2])] };
const v2: Version = { name: "Test X 2.0", base: "Test X", days: series("2026-11-09", [49, 32, 30, 33, 31, 30]) };
// Male-like: the original keeps about two thirds; the family total stays flat.
const fz: Version = { name: "Test Y", base: "Test Y", days: [...series("2026-04-06", Array(31).fill(150)), ...series("2026-11-09", Array(6).fill(100))] };
const male: Version = { name: "Test Y Male", base: "Test Y", days: series("2026-11-09", Array(6).fill(50)) };

test("kind: a relaunch replaces the old version; a variant sells next to it; nothing before = new", () => {
  assert.equal(kindOf("2026-11-09", [{ ...v1, start: "2026-04-06" }], asOf), "relaunch");
  assert.equal(kindOf("2026-11-09", [{ ...fz, start: "2026-04-06" }], asOf), "variant");
  assert.equal(kindOf("2026-11-09", [], asOf), "new");
  // Two versions starting the same week are not each other's predecessor.
  assert.equal(kindOf("2026-11-09", [{ ...male, start: "2026-11-10" }], asOf), "new");
});

test("read: a relaunch that lifted the family grew; a variant that only split it is flat; too early under 3 scored weeks", () => {
  const all = (vs: Version[]) => vs.flatMap(v => v.days).reduce((m, x) => m.set(x.d, (m.get(x.d) ?? 0) + x.o), new Map<string, number>());
  const days = (vs: Version[]) => [...all(vs)].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, o]) => ({ d, o, r: 0 }));
  const up = readOf(days([v1, v2]), co, "2026-11-09", asOf);
  assert.equal(up.read, "grew");
  assert.ok(up.lift! > 0.4);
  assert.equal(readOf(days([fz, male]), co, "2026-11-09", asOf).read, "flat");
  assert.equal(readOf(days([v1, v2]), co, "2026-11-09", "2026-11-22").read, "too-early");
});

test("events: grouped by family, newest first, with the share of each version and weekly orders by version", () => {
  const out = versionEvents([v1, v2, fz, male], co, asOf);
  assert.equal(out.length, 2);
  const x = out.find(b => b.base === "Test X")!;
  assert.equal(x.events.length, 1);
  assert.equal(x.events[0].kind, "relaunch");
  assert.equal(x.events[0].label, "2.0");
  assert.deepEqual(x.events[0].replaces, ["Test X"]);
  const y = out.find(b => b.base === "Test Y")!;
  assert.equal(y.events[0].kind, "variant");
  assert.ok(Math.abs(y.events[0].share - 1 / 3) < 0.02);
  const wk = y.weekly.find(w => w.week === "2026-11-09")!;
  assert.deepEqual(wk.byVersion, { "Test Y": 100, "Test Y Male": 50 });
  // Old versions with no recent start are not events.
  assert.equal(versionEvents([v1], co, asOf).length, 0);
});

test("events: under 10 orders since the start is not a launch; an official date leaves earlier orders out of the chart", () => {
  const tiny: Version = { name: "Test Z", base: "Test Z", days: series("2026-11-30", [3, 3]) };
  assert.equal(versionEvents([tiny], co, asOf).length, 0);
  const ny: Version = { name: "Gut Zoomer New York", base: "Gut Zoomer NY", days: [{ d: "2026-07-28", o: 3, r: 0 }, ...series("2026-08-24", [22, 28, 17, 18, 16, 21])] };
  const ev = versionEvents([ny], co, "2026-10-04")[0];
  assert.equal(ev.events[0].start, "2026-08-24");
  assert.equal(ev.events[0].official, true);
  assert.equal(ev.events[0].preOrders, 3);
  assert.equal(ev.events[0].kind, "new");
  assert.equal(ev.weekly.find(w => w.week === "2026-07-27")?.byVersion["Gut Zoomer New York"], undefined);
});

test("health: an established family whose last 2 full weeks fall below its own range is behind; above is ahead; a thin family is not read", () => {
  // 20 weeks at ~60 orders a week (attach 1.4 per 100 on 600 a day), Mondays from 2026-07-06; the last 2 full weeks before Nov 22 change.
  const mk = (tail: number) => series("2026-07-06", [...Array(18).fill(60), tail, tail]);
  const asOfW = "2026-11-15"; // 19 full weeks from Jul 6 end Nov 15
  const flat = healthOf("X", series("2026-07-06", Array(19).fill(60)), co, asOfW)!;
  assert.equal(flat.status, "on-trend");
  assert.equal(healthOf("X", mk(30), co, "2026-11-22")!.status, "behind");
  assert.equal(healthOf("X", mk(95), co, "2026-11-22")!.status, "ahead");
  assert.equal(healthOf("X", series("2026-07-06", Array(19).fill(2)), co, asOfW), null); // under 50 orders in the range
  assert.equal(healthOf("X", series("2026-10-05", Array(6).fill(60)), co, "2026-11-15"), null); // under 8 scored weeks
});

console.log(`${n} checks passed`);
