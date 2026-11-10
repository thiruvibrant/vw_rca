/**
 * Momentum tile (Overview): is the business speeding up or slowing down? METRIC_DEFINITIONS.md §8.
 *
 * build    — snapshot build step (engine/builder.ts, daily, before the main rebuild so the insight cards can use it):
 *            pulls ~3.3 years of daily company revenue and the 4- and 16-week revenue by state and by rep (this year and
 *            the same days last year) from Cube, runs the anomaly consensus model (momentumModel.ts) and stores one row.
 * summary  — the Overview tile (team logins only: it names states and reps).
 * Not gen-scoped: one row, replaced on each build. Company totals only; no clinic-level data is stored.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { DEFAULTS } from "./config";
import { load, O } from "./cube";
import { addDays, completeThrough } from "./dateUtils";
import { gatedQuery } from "./gated";
import { drivers, momentum, type Driver, type DriverInput, type Momentum } from "./momentumModel";

/** Daily history the model needs: 16 + 52 weeks, last year's trend (±182 days) and neighbours (±42 days), with slack. */
const HISTORY_DAYS = 1200;

export type MomentumSummary = Momentum & {
  builtAt: number;
  drivers: { states: Driver[]; reps: Driver[] };
};

export const replace = internalMutation({
  args: { asOf: v.string(), builtAt: v.number(), data: v.any() },
  handler: async (ctx, row) => {
    for (const r of await ctx.db.query("momentum").collect()) await ctx.db.delete(r._id);
    await ctx.db.insert("momentum", { key: "main", ...row });
  },
});

const num = (x: unknown) => Number(x ?? 0) || 0;

/** Revenue by one order dimension over a date range. */
async function revenueBy(dim: "state" | "sales_id", start: string, end: string): Promise<Map<string, number>> {
  const rows = await load({
    measures: [`${O}.revenue`],
    dimensions: [`${O}.${dim}`],
    timeDimensions: [{ dimension: `${O}.order_date`, dateRange: [start, end] }],
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[`${O}.${dim}`] ?? "").trim() || "—";
    out.set(k, (out.get(k) ?? 0) + num(r[`${O}.revenue`]));
  }
  return out;
}

export const build = internalAction({
  args: {},
  handler: async ctx => {
    const cfg = await ctx.runQuery(internal.config.getInternal, {});
    const last = await load({ measures: [`${O}.last_order`] });
    const maxDate = String(last[0]?.[`${O}.last_order`] ?? "").slice(0, 10);
    if (!maxDate) return { ok: false, reason: "no last_order date" };
    const asOf = completeThrough(maxDate, Math.min(cfg.lagDays, DEFAULTS.lagDays));

    const daily = await load({
      measures: [`${O}.revenue`],
      timeDimensions: [{ dimension: `${O}.order_date`, granularity: "day", dateRange: [addDays(asOf, -HISTORY_DAYS), asOf] }],
    });
    const revByDay = new Map<string, number>();
    for (const r of daily) revByDay.set(String(r[`${O}.order_date.day`]).slice(0, 10), num(r[`${O}.revenue`]));

    const m = momentum(revByDay, asOf);
    if (!m) return { ok: false, reason: "not enough history", asOf };

    // Drivers: who is behind the 4-week change, by state and by rep.
    const w4 = m.windows.find(w => w.weeks === 4)!;
    const w16 = m.windows.find(w => w.weeks === 16)!;
    const ly = (d: string) => addDays(d, -364);
    const ranges = [
      [w4.start, w4.end],
      [ly(w4.start), ly(w4.end)],
      [w16.start, w16.end],
      [ly(w16.start), ly(w16.end)],
    ] as const;
    const [byState, byRep, users, commission] = await Promise.all([
      Promise.all(ranges.map(([s, e]) => revenueBy("state", s, e))),
      Promise.all(ranges.map(([s, e]) => revenueBy("sales_id", s, e))),
      load({ dimensions: ["internal_user.internal_user_id", "internal_user.name"] }),
      load({ dimensions: ["sales_commission.sales_id", "sales_commission.sales_name"] }),
    ]);
    // Rep names as the main rebuild resolves them (refresh.ts): internal users first, then sales commission.
    const repName = new Map<string, string>();
    const addName = (id: unknown, name: unknown) => {
      const k = String(id ?? "").trim();
      const n = String(name ?? "").trim();
      if (k && n && n !== "null" && !repName.has(k)) repName.set(k, n);
    };
    for (const r of users) addName(r["internal_user.internal_user_id"], r["internal_user.name"]);
    for (const r of commission) addName(r["sales_commission.sales_id"], r["sales_commission.sales_name"]);
    const inputs = (maps: Map<string, number>[], label: (k: string) => string): DriverInput[] => {
      const keys = new Set(maps.flatMap(x => [...x.keys()]));
      return [...keys].map(k => ({ key: k, label: label(k), a4: maps[0].get(k) ?? 0, l4: maps[1].get(k) ?? 0, a16: maps[2].get(k) ?? 0, l16: maps[3].get(k) ?? 0 }));
    };
    const co = { a4: w4.actual, l4: w4.ly, e4: w4.expected, a16: w16.actual, l16: w16.ly, e16: w16.expected };
    const dir = m.direction || (w4.pct < m.usual ? -1 : 1);
    const summary: MomentumSummary = {
      ...m,
      builtAt: Date.now(),
      drivers: {
        states: drivers(inputs(byState, k => (k === "—" ? "No state" : k)), co, m.usual, dir),
        reps: drivers(inputs(byRep, k => repName.get(k) || (k === "—" ? "Unassigned" : `Sales ${k}`)), co, m.usual, dir),
      },
    };
    await ctx.runMutation(internal.momentum.replace, { asOf, builtAt: summary.builtAt, data: summary });
    return { ok: true, asOf, status: m.status, pattern: m.pattern, headline: m.headline };
  },
});

/** The stored momentum read, or null before the first build. */
export async function loadMomentum(ctx: QueryCtx): Promise<MomentumSummary | null> {
  const row = await ctx.db.query("momentum").first();
  return row ? (row.data as MomentumSummary) : null;
}

export const summary = gatedQuery({
  args: {},
  handler: async ctx => {
    const m = await loadMomentum(ctx);
    return m ? { ready: true as const, ...m } : { ready: false as const };
  },
});
