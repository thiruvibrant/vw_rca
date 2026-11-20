/**
 * Inputs for the Growth page that are not already on the scorecard (company-wide, so team logins only).
 */
import { internal } from "./_generated/api";
import { ordersRows } from "./cube";
import { addDays } from "./dateUtils";
import { gatedAction, gatedQuery, scopedAction, scopedQuery } from "./gated";
import { gutListsData, type GutLists } from "./gutLists";
import { loadCfg, viewerCfgKey } from "./config";
import { isCompanyLead, isTeamScope, teamOf } from "./scope";
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { loadLapsed } from "./gzLapsed";
import { TABLE } from "./powerbi";

/** Clinics that ordered Gut Zoomer last year and not this year, with what they ordered. Empty until the daily rebuild has run. */
export const lapsed = gatedQuery({
  args: {},
  handler: async ctx => {
    const rows = await loadLapsed(ctx);
    return {
      ready: rows.length > 0,
      year: rows[0]?.year ?? null,
      rows: rows.map(r => ({
        clinic: r.clinic, name: r.name, state: r.state, sales: r.sales, orders: r.orders, lastOrder: r.lastOrder, otherOrders: r.otherOrders,
        revenue: r.revenue ?? 0, revenueThis: r.revenueThis ?? 0, gzRevenue: r.gzRevenue,
      })),
    };
  },
});

export type ProviderClinic = { clinic: string; providers: number; active: number; dormant: number; dormantRevenue: number };

/**
 * Clinics where several providers have ordered over two years but only some still do (2026-11). A provider is a customer of the clinic.
 * Candidates: 3+ providers ordered in the last 24 months, the clinic itself ordered in the last 90 days, and 2+ providers have not ordered in
 * those 90 days. `dormantRevenue` is what those dormant providers brought in a year, from their last 24 months. Pure, for the tests.
 */
export function providerCandidates(
  all: Array<{ clinic: string; provider: string; orders: number; revenue: number }>,
  recent: Array<{ clinic: string; provider: string; orders: number }>,
): ProviderClinic[] {
  const active = new Set(recent.filter(r => r.orders > 0).map(r => `${r.clinic}|${r.provider}`));
  const by = new Map<string, { providers: number; active: number; dormant: number; rev: number }>();
  for (const r of all) {
    if (!r.clinic || !r.provider || r.orders <= 0) continue;
    const x = by.get(r.clinic) ?? { providers: 0, active: 0, dormant: 0, rev: 0 };
    x.providers += 1;
    if (active.has(`${r.clinic}|${r.provider}`)) x.active += 1;
    else {
      x.dormant += 1;
      x.rev += r.revenue / 2;
    }
    by.set(r.clinic, x);
  }
  return [...by]
    .filter(([, x]) => x.providers >= 3 && x.active >= 1 && x.dormant >= 2)
    .map(([clinic, x]) => ({ clinic, providers: x.providers, active: x.active, dormant: x.dormant, dormantRevenue: Math.round(x.rev) }));
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const providers = gatedAction({
  args: {},
  handler: async (ctx): Promise<{ ready: true; rows: ProviderClinic[] }> => providersData(ctx, viewerCfgKey(ctx) ?? ""),
});

/** The provider candidates, cached for the day under `prefix` ("" = the shared company copy; see gutListsData). */
async function providersData(ctx: any, prefix: string): Promise<{ ready: true; rows: ProviderClinic[] }> {
  {
    const end = dayOf(Date.now());
    const key = `${prefix}gprov1|${end}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, { key });
    if (hit) return JSON.parse(hit);
    const [all, recent] = await Promise.all([
      ordersRows({ by: ["clinic_id", "customer_id"], start: addDays(end, -729), end, m: { n: "orders", rev: "revenue" } }),
      ordersRows({ by: ["clinic_id", "customer_id"], start: addDays(end, -89), end, m: { n: "orders" } }),
    ]);
    const cl = (r: Record<string, unknown>) => String(r[`${TABLE}[clinic_id]`] ?? "");
    const pr = (r: Record<string, unknown>) => String(r[`${TABLE}[customer_id]`] ?? "");
    const num = (r: Record<string, unknown>, k: string) => (typeof r[`[${k}]`] === "number" ? (r[`[${k}]`] as number) : 0);
    const result = {
      ready: true as const,
      rows: providerCandidates(
        all.map(r => ({ clinic: cl(r), provider: pr(r), orders: num(r, "n"), revenue: num(r, "rev") })),
        recent.map(r => ({ clinic: cl(r), provider: pr(r), orders: num(r, "n") })),
      ),
    };
    await ctx.runMutation(internal.ingest.putCache, { key, payload: JSON.stringify(result) });
    return result;
  }
}

/** The clinic ids in a scope (a rep, a team lead's team, or the company), for cutting company-wide lists down to it. */
export const scopeClinics = internalQuery({
  args: { sales: v.string() },
  handler: async (ctx, { sales }): Promise<string[]> => {
    const cfg = await loadCfg(ctx);
    const gen = cfg?.gen ?? 0;
    const meta = isTeamScope(sales) && isCompanyLead(teamOf(sales))
      ? await ctx.db.query("clinicMeta").withIndex("by_gen", q => q.eq("gen", gen)).collect()
      : isTeamScope(sales)
      ? await ctx.db.query("clinicMeta").withIndex("by_gen_lead", q => q.eq("gen", gen).eq("teamLead", teamOf(sales))).collect()
      : await ctx.db.query("clinicMeta").withIndex("by_gen_sales", q => q.eq("gen", gen).eq("sales", sales)).collect();
    return meta.map(m => m.clinic);
  },
});

/** Lapsed Gut Zoomer clinics in a scope: the rep's own for a rep login (scopedQuery pins `sales`). For the week plan. */
export const lapsedFor = scopedQuery({
  args: { sales: v.string() },
  handler: async (ctx, { sales }) => {
    const rows = await loadLapsed(ctx, { sales });
    return {
      ready: rows.length > 0,
      rows: rows.map(r => ({ clinic: r.clinic, orders: r.orders, lastOrder: r.lastOrder, otherOrders: r.otherOrders, revenue: r.revenue ?? 0, revenueThis: r.revenueThis ?? 0, gzRevenue: r.gzRevenue })),
    };
  },
});

/**
 * The Growth page's company-wide lists (Gut Zoomer lists, dormant providers) cut to one scope, for a rep's week plan (2026-11-20). A rep login
 * only ever gets its own clinics: scopedAction pins `sales` to the rep. Reads the shared daily copy, so a rep never triggers a Cube pull of its own
 * unless the company copy is not built yet today.
 */
export type RepInputs = {
  gut: { asOf: string; lists: Pick<GutLists, "refGzOrdersYear" | "stopped" | "similar" | "lost" | "noGut"> & Partial<Pick<GutLists, "newPatients" | "followUp">> } | null;
  providers: ProviderClinic[] | null;
};
export const repInputs = scopedAction({
  args: { sales: v.string() },
  handler: async (ctx, { sales }): Promise<RepInputs> => {
    const list: string[] = await ctx.runQuery(internal.growth.scopeClinics, { sales });
    const ids = new Set<string>(list);
    const [gut, prov] = await Promise.all([gutListsData(ctx, "").catch(() => null), providersData(ctx, "").catch(() => null)]);
    const cut = <T extends { clinic: string }>(xs: T[] | undefined): T[] => (xs ?? []).filter(x => ids.has(x.clinic));
    return {
      gut: gut ? { asOf: gut.asOf, lists: {
        refGzOrdersYear: gut.lists.refGzOrdersYear,
        stopped: cut(gut.lists.stopped), similar: cut(gut.lists.similar), lost: cut(gut.lists.lost), noGut: cut(gut.lists.noGut),
        newPatients: gut.lists.newPatients ? cut(gut.lists.newPatients) : undefined, followUp: gut.lists.followUp ? cut(gut.lists.followUp) : undefined,
      } } : null,
      providers: prov ? cut(prov.rows) : null,
    };
  },
});
