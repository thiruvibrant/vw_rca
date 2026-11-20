/**
 * Cohort movement, last 12 months (2026-11-20): month by month, the clinics that moved up to the Top 20% list, down to
 * the rest, into Churned and back from it (analytics/clinicLabels.ts flowsOf), for the company, a team or one rep.
 * Rows come from cohortHistory (analytics/cohortHistory.ts), written by the rebuild.
 *
 * Scope as in the rep view: `sales` = a rep, or "team:<lead>" (a team), or "team:*" / nothing (the company); reps are
 * pinned to their own name by scopedQuery.
 */
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { decodeLabel, flowGroupOf, flowsOf, type FlowGroup } from "./clinicLabels";
import { loadCfg } from "./config";
import { scopedQuery } from "./gated";
import { isCompanyLead, isTeamScope, teamOf } from "./scope";

type HistoryRow = { clinic: string; name: string; sales: string; teamLead: string; labelAt: Record<string, string>; rev: Record<string, number> };

async function rowsFor(ctx: QueryCtx, gen: number, sales?: string, teamLead?: string): Promise<HistoryRow[]> {
  const q = ctx.db.query("cohortHistory");
  const scope = sales ?? (teamLead ? `team:${teamLead}` : undefined);
  const rows = !scope || (isTeamScope(scope) && isCompanyLead(teamOf(scope)))
    ? await q.withIndex("by_gen", x => x.eq("gen", gen)).collect()
    : isTeamScope(scope)
    ? await q.withIndex("by_gen_lead", x => x.eq("gen", gen).eq("teamLead", teamOf(scope))).collect()
    : await q.withIndex("by_gen_sales", x => x.eq("gen", gen).eq("sales", scope)).collect();
  return rows as unknown as HistoryRow[];
}

/** The 13 most recent label dates on any row (12 moves), oldest first. */
function datesOf(rows: HistoryRow[]): string[] {
  const all = new Set<string>();
  for (const r of rows) for (const d of Object.keys(r.labelAt)) all.add(d);
  return [...all].sort().slice(-13);
}

const scopeArgs = { sales: v.optional(v.string()), teamLead: v.optional(v.string()) };

export const summary = scopedQuery({
  args: scopeArgs,
  handler: async (ctx, args) => {
    const cfg = await loadCfg(ctx);
    if (!cfg) return { ready: false as const };
    const rows = await rowsFor(ctx, cfg.gen ?? 0, args.sales, args.teamLead);
    if (!rows.length) return { ready: false as const };
    const revOf = new Map(rows.map(r => [r.clinic, r.rev]));
    const flows = flowsOf(rows, datesOf(rows), (c, m) => revOf.get(c)?.[m] ?? 0);
    // Newest month first.
    return { ready: true as const, dataThrough: cfg.currentEnd, clinics: rows.length, rows: flows.reverse() };
  },
});

/** The clinics behind one cell of the table, largest revenue first. */
export const clinics = scopedQuery({
  args: { ...scopeArgs, from: v.string(), to: v.string(), group: v.string() },
  handler: async (ctx, args) => {
    const cfg = await loadCfg(ctx);
    if (!cfg) return { ready: false as const, rows: [] };
    const rows = await rowsFor(ctx, cfg.gen ?? 0, args.sales, args.teamLead);
    const group = args.group as FlowGroup;
    const out = [];
    for (const r of rows) {
      const before = decodeLabel(r.labelAt[args.from]), after = decodeLabel(r.labelAt[args.to]);
      if (flowGroupOf(before, after) !== group) continue;
      const month = (group === "down" || group === "churn" ? args.from : args.to).slice(0, 7);
      out.push({ clinic: r.clinic, name: r.name, sales: r.sales, before, after, rev: r.rev[month] ?? 0, revMonth: month });
    }
    out.sort((a, b) => b.rev - a.rev || a.name.localeCompare(b.name));
    return { ready: true as const, total: out.length, rows: out.slice(0, 300) };
  },
});
