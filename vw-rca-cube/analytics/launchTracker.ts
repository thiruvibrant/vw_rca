/**
 * New product launches (2026-11-24; method in analytics/launchModel.ts). `build` runs after each daily rebuild: it pulls company
 * orders by day and every tracked family's orders and revenue by day from Cube, plus, for each launch, how many clinics tried it and how
 * many of them already ordered the parent Zoomer in the year before. `summary` scores each launch against the earlier launches at the
 * same age: attach rate per launch week, the reference band, status, trend, dollars, and a focus rank.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { loadCfg } from "./config";
import { O, ordersRows } from "./cube";
import { addDays } from "./dateUtils";
import { scopedQuery } from "./gated";
import { dollarsOf, flatBand, launchDateOf, launchWeeks, LAUNCHES, normalCompanyWeek, ownBand, REFERENCES, referenceBand, scoredWeeks, statusOf, trendOf, type Day } from "./launchModel";
import { dateOf, familyOf, num, splitFamilies, TABLE } from "./powerbi";

const START = "2025-01-01";
const COMPANY = "__company";
const contains = (fam: string) => ({ member: `${O}.product_family`, operator: "contains" as const, values: [fam] });

export const build = internalAction({
  args: { end: v.optional(v.string()) },
  handler: async (ctx, { end }) => {
    const through = end ?? new Date().toISOString().slice(0, 10);
    const wanted = new Set([...LAUNCHES.map(l => l.family), ...REFERENCES]);
    const [co, fam] = await Promise.all([
      ordersRows({ day: true, m: { ord: "orders" }, start: START, end: through }),
      ordersRows({ family: true, day: true, m: { ord: "orders", rev: "revenue" }, start: START, end: through }),
    ]);
    // Orders per family-day count in every family of a combination; revenue is split across them pro rata, as in the Product family tiles.
    const byFam = new Map<string, Map<string, Day>>();
    for (const r of fam) {
      const d = dateOf(r, "order_date");
      if (!d) continue;
      const parts = splitFamilies(familyOf(r));
      for (const f of parts) {
        if (!wanted.has(f)) continue;
        const m = byFam.get(f) ?? new Map<string, Day>();
        const a = m.get(d) ?? { d, o: 0, r: 0 };
        a.o += num(r, "ord");
        a.r += num(r, "rev") / parts.length;
        m.set(d, a);
        byFam.set(f, m);
      }
    }
    const rows: Array<{ family: string; kind: string; parent?: string; launch?: string; leadership?: boolean; relaunch?: boolean; firstDate?: string; preOrders?: number; days: Day[]; tried?: number; hadParent?: number; eligible?: number }> = [];
    const coDays = new Map<string, number>();
    for (const r of co) {
      const d = dateOf(r, "order_date");
      if (d) coDays.set(d, (coDays.get(d) ?? 0) + num(r, "ord"));
    }
    rows.push({ family: COMPANY, kind: "company", days: [...coDays].map(([d, o]) => ({ d, o, r: 0 })) });
    for (const f of REFERENCES) {
      if (LAUNCHES.some(l => l.family === f)) continue;
      const days = [...(byFam.get(f)?.values() ?? [])].sort((a, b) => (a.d < b.d ? -1 : 1));
      rows.push({ family: f, kind: "reference", launch: launchDateOf(days) ?? undefined, days: days.map(x => ({ ...x, r: Math.round(x.r) })) });
    }
    for (const l of LAUNCHES) {
      const days = [...(byFam.get(l.family)?.values() ?? [])].sort((a, b) => (a.d < b.d ? -1 : 1));
      const firstAuto = launchDateOf(days) ?? undefined;
      const launch = l.date ?? firstAuto;
      const relaunch = l.kind === "relaunch";
      // Orders dated before the official launch date (a system issue put a few in) are left out of the launch weeks; counted for the note.
      const preOrders = !relaunch && launch ? Math.round(days.filter(x => x.d < launch).reduce((t, x) => t + x.o, 0)) : undefined;
      let tried: number | undefined, hadParent: number | undefined, eligible: number | undefined;
      if (launch) {
        // Clinics that tried it, and the clinics that ordered the parent Zoomer in the 12 months before the launch (the eligible pool).
        const [t, p] = await Promise.all([
          ordersRows({ by: ["clinic_id"], m: { n: "orders" }, start: launch, end: through, filters: [contains(l.family)] }),
          ordersRows({ by: ["clinic_id"], m: { n: "orders" }, start: addDays(launch, -365), end: addDays(launch, -1), filters: [contains(l.parent)] }),
        ]);
        const id = (r: Record<string, unknown>) => String(r[`${TABLE}[clinic_id]`] ?? "");
        const pool = new Set(p.map(id).filter(Boolean));
        const tr = new Set(t.map(id).filter(Boolean));
        tried = tr.size;
        eligible = pool.size;
        hadParent = [...tr].filter(c => pool.has(c)).length;
      }
      rows.push({ family: l.family, kind: "launch", parent: l.parent, launch, leadership: !!l.date, relaunch, firstDate: relaunch ? firstAuto : undefined, preOrders, days: days.map(x => ({ ...x, r: Math.round(x.r) })), tried, hadParent, eligible });
    }
    await ctx.runMutation(internal.launchTracker.put, { rows });
    return { families: rows.length - 1 };
  },
});

export const put = internalMutation({
  args: {
    rows: v.array(
      v.object({
        family: v.string(),
        kind: v.string(),
        parent: v.optional(v.string()),
        launch: v.optional(v.string()),
        leadership: v.optional(v.boolean()),
        relaunch: v.optional(v.boolean()),
        firstDate: v.optional(v.string()),
        preOrders: v.optional(v.number()),
        days: v.array(v.object({ d: v.string(), o: v.number(), r: v.number() })),
        tried: v.optional(v.number()),
        hadParent: v.optional(v.number()),
        eligible: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    for (const old of await ctx.db.query("launchTracker").collect()) await ctx.db.delete(old._id);
    for (const r of rows) await ctx.db.insert("launchTracker", r);
  },
});

export const summary = scopedQuery({
  args: {},
  handler: async ctx => {
    const cfg = await loadCfg(ctx);
    const rows = await ctx.db.query("launchTracker").collect();
    const co = rows.find(r => r.kind === "company");
    if (!cfg || !co) return { ready: false as const };
    const asOf = cfg.currentEnd;
    const company = new Map(co.days.map(x => [x.d, x.o]));
    const normal = normalCompanyWeek(company, asOf);
    const weeksOf = (r: (typeof rows)[number]) => (r.launch ? launchWeeks(r.days, company, r.launch, asOf) : []);
    // A relaunched product is a reference from its first launch, not from the relaunch.
    const refWeeksOf = (r: (typeof rows)[number]) => { const s = r.relaunch ? r.firstDate : r.launch; return s ? launchWeeks(r.days, company, s, asOf) : []; };
    const refWeeks = new Map(rows.filter(r => r.kind !== "company" && REFERENCES.includes(r.family)).map(r => [r.family, refWeeksOf(r)]));
    const maxWeek = 14;
    const launches = rows
      .filter(r => r.kind === "launch" && r.launch)
      .map(r => {
        const weeks = weeksOf(r);
        // The other references only: a launch is never its own yardstick.
        // A relaunch is judged against its own range before the relaunch; a launch against earlier launches at the same age.
        const own = r.relaunch && r.firstDate ? ownBand(launchWeeks(r.days, company, r.firstDate, addDays(r.launch!, -1))) : null;
        const band = r.relaunch ? flatBand(own, maxWeek) : referenceBand([...refWeeks].filter(([f]) => f !== r.family).map(([, w]) => w), maxWeek);
        const status = statusOf(weeks, band, asOf, r.launch!);
        const tr = trendOf(weeks);
        const d = dollarsOf(weeks, band, normal);
        const last = scoredWeeks(weeks).slice(-1)[0];
        return {
          family: r.family,
          parent: r.parent ?? "",
          launch: r.launch!,
          fromLeadership: !!r.leadership,
          relaunch: !!r.relaunch,
          firstLaunch: r.relaunch ? r.firstDate ?? null : null,
          ownRange: own ? { p25: own.p25, median: own.median, p75: own.p75, weeks: own.weeks } : null,
          preOrders: r.preOrders ?? 0,
          daysLive: Math.round((Date.parse(asOf) - Date.parse(r.launch!)) / 864e5) + 1,
          orders: weeks.reduce((t, w) => t + w.orders, 0),
          status,
          trend: tr?.trend ?? null,
          trendRatio: tr?.ratio ?? null,
          weeks: weeks.map(w => ({ n: w.n, start: w.start, complete: w.complete, holiday: w.holiday, orders: w.orders, attach: w.attach })),
          band: band.slice(0, Math.max(weeks.length, 8)).map(b => (b ? { n: b.n, p25: b.p25, median: b.median, p75: b.p75 } : null)),
          lastScored: last ? { n: last.n, attach: last.attach, orders: last.orders } : null,
          revenue: d.revenue,
          runRate: d.runRate,
          perOrder: d.perOrder,
          potential: d.potential,
          upside: d.upside,
          tried: r.tried ?? null,
          hadParent: r.hadParent ?? null,
          eligible: r.eligible ?? null,
          rank: 0,
        };
      });
    // Focus: the weekly dollars at stake first (what it brings now, or what a typical launch would bring if that is more), among launches
    // old enough to read and still launching; the rest follow, newest first.
    const stake = (l: (typeof launches)[number]) => Math.max(l.potential ?? 0, l.runRate ?? 0);
    const readable = launches.filter(l => l.status !== "too-early" && l.status !== "mature").sort((a, b) => stake(b) - stake(a));
    readable.forEach((l, i) => (l.rank = i + 1));
    launches.sort((a, b) => (a.rank || 99) - (b.rank || 99) || (a.launch < b.launch ? 1 : -1));
    return {
      ready: true as const,
      asOf,
      normalCompanyWeek: normal,
      references: [...refWeeks].map(([family, w]) => ({ family, launch: rows.find(r => r.family === family)?.launch ?? "", scored: scoredWeeks(w).length })),
      launches,
    };
  },
});
