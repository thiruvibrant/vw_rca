/**
 * New launches, relaunches and variants by test version (2026-11-25; method in analytics/versionModel.ts). `build` runs after each daily
 * rebuild: orders by raw test name (`order_tests.test_version`, which keeps "2.0" and "Male") and cleaned name (`order_tests.test_name`)
 * by day, and the company's orders by day. `summary` lists every base (cleaned name = the product family's name) with a start in the last
 * 180 days: what started, whether it is new, a relaunch or a variant, the base's attach rate before and since, and its weekly orders by
 * version for a stacked chart.
 *
 * Needs the Cube dimension `order_tests.test_version` and its rollup `version_daily` (cube/model-vibrant). Until that is deployed the step
 * fails, the table stays empty and the screens hide the badges and the version chart.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { loadCfg } from "./config";
import { orderDays, ordersRows, rows as cubeRows } from "./cube";
import { addDays } from "./dateUtils";
import { scopedQuery } from "./gated";
import { type Day } from "./launchModel";
import { dateOf, num } from "./powerbi";
import { versionEvents, type Version } from "./versionModel";

/** Days of history pulled: 180 days of events, 13 weeks before the earliest, and room so a long-running version never looks new. */
const HISTORY_DAYS = 420;
const COMPANY = "__company";

export const build = internalAction({
  args: { end: v.optional(v.string()) },
  handler: async (ctx, { end }) => {
    const through = end ?? new Date().toISOString().slice(0, 10);
    const start = addDays(through, -HISTORY_DAYS);
    const [ver, co] = await Promise.all([
      cubeRows(
        {
          measures: ["order_tests.orders"],
          dimensions: ["order_tests.test_version", "order_tests.test_name"],
          timeDimensions: orderDays(start, through, "day"),
        },
        { "order_tests.test_version": "name", "order_tests.test_name": "base", "order_tests.orders": "[ord]", "rfm_orders.order_date": "order_date" },
      ),
      ordersRows({ day: true, m: { ord: "orders" }, start, end: through }),
    ]);
    const by = new Map<string, { name: string; base: string; days: Map<string, number> }>();
    for (const r of ver) {
      const name = String(r.name ?? "").trim(), base = String(r.base ?? "").trim();
      const d = String(r.order_date ?? "").slice(0, 10);
      const n = num(r, "ord");
      if (!name || !base || !d || n <= 0) continue;
      const k = `${name}\u0000${base}`;
      const a = by.get(k) ?? { name, base, days: new Map<string, number>() };
      a.days.set(d, (a.days.get(d) ?? 0) + n);
      by.set(k, a);
    }
    const coDays = new Map<string, number>();
    for (const r of co) {
      const d = dateOf(r, "order_date");
      if (d) coDays.set(d, (coDays.get(d) ?? 0) + num(r, "ord"));
    }
    const out = [
      { name: COMPANY, base: COMPANY, days: [...coDays].map(([d, o]) => ({ d, o })) },
      ...[...by.values()].map(a => ({ name: a.name, base: a.base, days: [...a.days].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([d, o]) => ({ d, o })) })),
    ];
    await ctx.runMutation(internal.productVersions.put, { rows: out });
    return { versions: out.length - 1, from: start };
  },
});

export const put = internalMutation({
  args: { rows: v.array(v.object({ name: v.string(), base: v.string(), days: v.array(v.object({ d: v.string(), o: v.number() })) })) },
  handler: async (ctx, { rows }) => {
    for (const old of await ctx.db.query("productVersions").collect()) await ctx.db.delete(old._id);
    for (const r of rows) await ctx.db.insert("productVersions", r);
  },
});

export const summary = scopedQuery({
  args: {},
  handler: async ctx => {
    const cfg = await loadCfg(ctx);
    const rows = await ctx.db.query("productVersions").collect();
    const co = rows.find(r => r.name === COMPANY);
    if (!cfg || !co) return { ready: false as const };
    const asOf = cfg.currentEnd;
    const company = new Map(co.days.map(x => [x.d, x.o]));
    const versions: Version[] = rows
      .filter(r => r.name !== COMPANY)
      .map(r => ({ name: r.name, base: r.base, days: r.days.filter(x => x.d <= asOf).map(x => ({ d: x.d, o: x.o, r: 0 }) as Day) }));
    return { ready: true as const, asOf, bases: versionEvents(versions, company, asOf) };
  },
});
