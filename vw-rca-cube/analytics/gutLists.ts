/**
 * Gut Zoomer growth lists (Thiru, 11 Nov 2026), computed from the dashboard's own data so they stay current.
 *
 * Every list is made of top-20% clinics (by revenue, 1 Jan – 31 Oct 2026), and a clinic sits on the first list it fits, in this order:
 * 1 stopped, 2 new patients, 3 similar clinics, 6 follow-up, then 4 and 5. The months are fixed, as in the analysis, and all sit after the
 * February 2026 Gut Zoomer price rise so the price cannot explain a drop. Lists 2 and 6 count patients, through a pseudonymous patient key
 * that the Cube model exposes (cube/model-vibrant, customer_rfm_segmented_orders.yml). Until that model change is deployed they are left out
 * (`patients` is false) and lists 1, 3, 4 and 5 still build. The key is used here only to count per clinic and is never returned.
 *
 * `buildLists` is pure (maps in, rows out) and is what the tests cover; `gutLists` below pulls the maps from Cube.
 */
import { internal } from "./_generated/api";
import { viewerCfgKey } from "./config";
import { eq, O, ordersRows, rows as cubeRows } from "./cube";
import { resolveIdentities } from "./familyStops";
import { gatedAction } from "./gated";
import { splitFamilies, TABLE } from "./powerbi";

/** The fixed windows of the analysis. */
export const W = {
  revStart: "2026-01-01",
  revEnd: "2026-10-31",
  aStart: "2026-03-01",
  aEnd: "2026-06-30",
  bStart: "2026-07-01",
  bEnd: "2026-10-31",
  checkEnd: "2026-11-10",
  y25Start: "2025-01-01",
  y25End: "2025-12-31",
} as const;
export const GZ_BASELINE_PRICE = 460;

export type GutData = {
  /** Revenue 1 Jan – 31 Oct 2026, all products, and the part from VW / VW+VA orders. */
  rev: Map<string, number>;
  vwRev: Map<string, number>;
  /** Gut Zoomer orders Mar–Jun and Jul–Oct 2026, and the revenue of the Mar–Jun ones. */
  gzA: Map<string, number>;
  gzB: Map<string, number>;
  gzARev: Map<string, number>;
  /** Last Gut Zoomer order date from 1 Mar to 10 Nov 2026. */
  gzLast: Map<string, string>;
  /** Gut Zoomer in 2025 (orders and revenue of orders with one), and the clinics with any Gut Zoomer 1 Jan – 10 Nov 2026. */
  gz25: Map<string, number>;
  gz25Rev: Map<string, number>;
  gz26: Set<string>;
  fz26: Set<string>;
  baseline26: Set<string>;
  /** Other Zoomer families ordered in 2026 (not Gut, not Foundation). */
  zoomers26: Map<string, string[]>;
  /** All orders and Gut Zoomer orders Mar–Oct 2026, and all orders Jul–Oct 2026. */
  ordersMarOct: Map<string, number>;
  gzMarOct: Map<string, number>;
  ordersB: Map<string, number>;
  /** The clinic's main provider's credential group, 3-digit ZIP area and state. */
  peer: Map<string, { cred: string; zip3: string; state: string }>;
  /** Lists 2 and 6, once the patient key is in the Cube model (otherwise absent). New patients first seen Mar–Jun (a) and Jul–Aug (b) 2026, and how many got a Gut Zoomer within 60 days. */
  newPat?: Map<string, { a: number; aGz: number; b: number; bGz: number }>;
  /** Patients whose latest Gut Zoomer is 150–240 days old (due) or 241–365 (overdue) at 10 Nov 2026, with no Gut Zoomer or Gut Baseline since. */
  follow?: Map<string, { due: number; overdue: number }>;
};

export type StoppedRow = { clinic: string; gzA: number; gzARev: number; daysSince: number; otherOrders: number };
export type SimilarRow = { clinic: string; cred: string; peers: number; peerScope: "zip" | "state"; clinicRate: number; peerRate: number; orders: number; gapRevenue: number };
export type LostRow = { clinic: string; gz25: number; gz25Rev: number; fz: boolean };
export type NoGutRow = { clinic: string; zoomers: string[]; hadGz: boolean };
export type NewPatRow = { clinic: string; newA: number; shareA: number; newB: number; shareB: number };
export type FollowRow = { clinic: string; due: number; overdue: number };
export type GutLists = { patients: boolean; newPatients: NewPatRow[]; followUp: FollowRow[]; topCut: number; topN: number; /** Gut Zoomer orders a year of a top-20% clinic that orders it (Mar–Oct, annualized): how often a top clinic does gut testing. */ refGzOrdersYear: number; stopped: StoppedRow[]; similar: SimilarRow[]; lost: LostRow[]; noGut: NoGutRow[] };

const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
const get = <T,>(m: Map<string, T>, k: string, d: T): T => m.get(k) ?? d;

/** The value that a fifth of the (positive) amounts reach or pass. */
export function topCut(amounts: number[]): number {
  const s = amounts.filter(x => x > 0).sort((a, b) => b - a);
  return s.length ? s[Math.max(0, Math.ceil(s.length * 0.2) - 1)] : 0;
}

export function buildLists(d: GutData): GutLists {
  const clinics = [...d.rev].filter(([, r]) => r > 0);
  const cut = topCut(clinics.map(([, r]) => r));
  const top = new Set(clinics.filter(([, r]) => r >= cut).map(([c]) => c));
  const vwShare = (c: string) => (get(d.rev, c, 0) > 0 ? get(d.vwRev, c, 0) / get(d.rev, c, 1) : 0);
  const taken = new Set<string>();

  // List 1: 5+ Gut Zoomer in Mar–Jun and none since July (a restart before 10 Nov is not "stopped").
  const stopped: StoppedRow[] = [];
  for (const c of top) {
    if (get(d.gzA, c, 0) >= 5 && get(d.gzB, c, 0) === 0 && !((d.gzLast.get(c) ?? "") >= W.bStart)) {
      stopped.push({ clinic: c, gzA: get(d.gzA, c, 0), gzARev: get(d.gzARev, c, 0), daysSince: Math.round(day(W.checkEnd) - day(d.gzLast.get(c) ?? W.aEnd)), otherOrders: get(d.ordersB, c, 0) });
      taken.add(c);
    }
  }

  // List 2: 10+ new patients in each period, 20%+ got a Gut Zoomer before, and the share fell by 15 points or more.
  const newPatients: NewPatRow[] = [];
  if (d.newPat) {
    for (const [c, x] of d.newPat) {
      if (!top.has(c) || taken.has(c) || x.a < 10 || x.b < 10) continue;
      const sa = x.aGz / x.a;
      const sb = x.bGz / x.b;
      if (sa >= 0.2 && sa - sb >= 0.15) {
        newPatients.push({ clinic: c, newA: x.a, shareA: sa, newB: x.b, shareB: sb });
        taken.add(c);
      }
    }
  }

  // List 3: same credential in the same ZIP area (5+ peers, else the same state): at least half of the peers order Gut Zoomer and this
  // clinic's Gut Zoomer share of orders is under half of theirs.
  const ofPeer = new Map<string, string[]>();
  const add = (k: string, c: string) => ofPeer.set(k, [...(ofPeer.get(k) ?? []), c]);
  for (const [c, p] of d.peer) {
    if (get(d.ordersMarOct, c, 0) <= 0) continue;
    add(`z|${p.cred}|${p.zip3}`, c);
    add(`s|${p.cred}|${p.state}`, c);
  }
  const similar: SimilarRow[] = [];
  for (const c of top) {
    if (taken.has(c)) continue;
    const orders = get(d.ordersMarOct, c, 0);
    const gz = get(d.gzMarOct, c, 0);
    const p = d.peer.get(c);
    if (!p || orders < 20 || gz < 1) continue;
    let group = (ofPeer.get(`z|${p.cred}|${p.zip3}`) ?? []).filter(x => x !== c);
    let scope: "zip" | "state" = "zip";
    if (group.length < 5) {
      group = (ofPeer.get(`s|${p.cred}|${p.state}`) ?? []).filter(x => x !== c);
      scope = "state";
    }
    if (group.length < 5) continue;
    const peerOrders = group.reduce((t, x) => t + get(d.ordersMarOct, x, 0), 0);
    const peerGz = group.reduce((t, x) => t + get(d.gzMarOct, x, 0), 0);
    const ordering = group.filter(x => get(d.gzMarOct, x, 0) > 0).length / group.length;
    const peerRate = peerOrders ? peerGz / peerOrders : 0;
    const clinicRate = gz / orders;
    if (ordering >= 0.5 && peerRate > 0 && clinicRate < 0.5 * peerRate) {
      const avgGz = get(d.gzARev, c, 0) / Math.max(1, get(d.gzA, c, 0));
      similar.push({ clinic: c, cred: p.cred, peers: group.length, peerScope: scope, clinicRate, peerRate, orders, gapRevenue: (peerRate - clinicRate) * orders * (12 / 8) * (avgGz > 0 ? avgGz : 550) });
      taken.add(c);
    }
  }

  // List 6: 5+ patients due or overdue for a follow-up gut test, each counted once at the clinic of their latest Gut Zoomer.
  const followUp: FollowRow[] = [];
  if (d.follow) {
    for (const [c, x] of d.follow) {
      if (!top.has(c) || taken.has(c) || x.due + x.overdue < 5) continue;
      followUp.push({ clinic: c, due: x.due, overdue: x.overdue });
      taken.add(c);
    }
  }

  // List 4: a top-20% Gut Zoomer clinic of 2025 (5+ orders), no Gut Zoomer in 2026, still top 20% and VW-dependent, still ordering other Zoomers.
  const gzClinics = [...d.gz25Rev].filter(([c, r]) => r > 0 && get(d.gz25, c, 0) >= 5);
  const gzCut = topCut(gzClinics.map(([, r]) => r));
  const lost: LostRow[] = [];
  for (const [c, r] of gzClinics) {
    if (r < gzCut || taken.has(c) || !top.has(c) || d.gz26.has(c) || vwShare(c) < 0.5 || !(d.zoomers26.get(c)?.length)) continue;
    lost.push({ clinic: c, gz25: get(d.gz25, c, 0), gz25Rev: r, fz: d.fz26.has(c) });
    taken.add(c);
  }

  // List 5: top-20% and VW-dependent with no Foundation Zoomer, Gut Zoomer or Gut Baseline in 2026.
  const noGut: NoGutRow[] = [];
  for (const c of top) {
    if (taken.has(c) || vwShare(c) < 0.5 || d.gz26.has(c) || d.fz26.has(c) || d.baseline26.has(c)) continue;
    noGut.push({ clinic: c, zoomers: d.zoomers26.get(c) ?? [], hadGz: get(d.gz25, c, 0) > 0 });
  }
  const ordering = [...top].filter(c => get(d.gzMarOct, c, 0) > 0);
  const refGzOrdersYear = ordering.length ? (ordering.reduce((t, c) => t + get(d.gzMarOct, c, 0), 0) / ordering.length) * (12 / 8) : 0;
  return {
    patients: !!d.newPat && !!d.follow,
    newPatients: newPatients.sort((a, b) => b.newA + b.newB - (a.newA + a.newB)),
    followUp: followUp.sort((a, b) => b.due + b.overdue - (a.due + a.overdue)),
    topCut: cut,
    topN: top.size,
    refGzOrdersYear,
    stopped: stopped.sort((a, b) => b.gzARev - a.gzARev),
    similar: similar.sort((a, b) => b.gapRevenue - a.gapRevenue),
    lost: lost.sort((a, b) => b.gz25Rev - a.gz25Rev),
    noGut,
  };
}

/** A credential string reduced to the groups the analysis uses. */
export function credentialGroup(raw: string): string {
  const s = (raw ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "Others";
  if (/NP/.test(s)) return "NP";
  if (/^(DO|OD)$|^DO/.test(s)) return "DO";
  if (/DC/.test(s)) return "DC";
  if (/ND/.test(s)) return "ND";
  if (/RD/.test(s)) return "RD";
  if (/MD/.test(s)) return "MD";
  return "Others";
}

const clin = (r: Record<string, unknown>) => String(r[`${TABLE}[clinic_id]`] ?? "");
const num = (r: Record<string, unknown>, k: string) => (typeof r[`[${k}]`] === "number" ? (r[`[${k}]`] as number) : 0);
const toMap = (rows: Array<Record<string, unknown>>, k: string) => {
  const m = new Map<string, number>();
  for (const r of rows) if (clin(r)) m.set(clin(r), (m.get(clin(r)) ?? 0) + num(r, k));
  return m;
};
const gzF = { member: `${O}.product_family`, operator: "contains" as const, values: ["Gut Zoomer"] };
const fzF = { member: `${O}.product_family`, operator: "contains" as const, values: ["Foundation Zoomer"] };
const baseF = { member: "order_tests.test_name", operator: "contains" as const, values: ["Gut Baseline"] };

const pat = (r: Record<string, unknown>) => String(r[`${TABLE}[patient_id]`] ?? "");
const dstr = (r: Record<string, unknown>, k: string) => String(r[`[${k}]`] ?? "").slice(0, 10);

/**
 * Lists 2 and 6 from the pseudonymous patient key. Returns null when the Cube model does not have it yet, so the other lists still work.
 * New patient = first order at the clinic since 1 Mar 2026 with no order there from 1 Jan 2024 (a patient away for longer than that counts as new).
 * "Got a Gut Zoomer" = a Gut Zoomer order within 60 days of the first visit (the analysis found 96% come on the very first order).
 */
export async function pullPatients(): Promise<{ newPat: NonNullable<GutData["newPat"]>; follow: NonNullable<GutData["follow"]> } | null> {
  try {
    const pk = ["clinic_id", "patient_id"];
    const [older, newer, gzNew, gzAll, baseAll] = await Promise.all([
      ordersRows({ by: pk, start: "2024-01-01", end: "2026-02-28", m: { n: "orders" } }),
      ordersRows({ by: pk, start: W.aStart, end: "2026-08-31", m: { n: "orders", first: "first_order" } }),
      ordersRows({ by: pk, start: W.aStart, end: W.bEnd, m: { n: "orders", first: "first_order" }, filters: [gzF] }),
      ordersRows({ by: pk, start: "2025-11-10", end: W.checkEnd, m: { n: "orders", last: "last_order" }, filters: [gzF] }),
      ordersRows({ by: ["patient_id"], start: "2025-11-10", end: W.checkEnd, m: { n: "orders", last: "last_order" }, filters: [baseF] }),
    ]);
    const old = new Set(older.filter(r => pat(r)).map(r => `${clin(r)}|${pat(r)}`));
    const gzFirst = new Map(gzNew.filter(r => pat(r)).map(r => [`${clin(r)}|${pat(r)}`, dstr(r, "first")]));
    const newPat = new Map<string, { a: number; aGz: number; b: number; bGz: number }>();
    for (const r of newer) {
      const key = `${clin(r)}|${pat(r)}`;
      if (!pat(r) || old.has(key)) continue;
      const first = dstr(r, "first");
      if (!first) continue;
      const g = gzFirst.get(key);
      const got = g !== undefined && g >= first && day(g) - day(first) <= 60;
      const x = newPat.get(clin(r)) ?? { a: 0, aGz: 0, b: 0, bGz: 0 };
      if (first <= W.aEnd) { x.a += 1; if (got) x.aGz += 1; }
      else if (first >= W.bStart) { x.b += 1; if (got) x.bGz += 1; }
      newPat.set(clin(r), x);
    }
    // Each patient once, at the clinic of their latest Gut Zoomer; no Gut Zoomer or Gut Baseline since.
    const latest = new Map<string, { clinic: string; date: string }>();
    for (const r of gzAll) {
      const p = pat(r);
      const date = dstr(r, "last");
      if (!p || !date) continue;
      const cur = latest.get(p);
      if (!cur || date > cur.date) latest.set(p, { clinic: clin(r), date });
    }
    const baseLast = new Map(baseAll.filter(r => pat(r)).map(r => [pat(r), dstr(r, "last")]));
    const follow = new Map<string, { due: number; overdue: number }>();
    for (const [p, v] of latest) {
      if ((baseLast.get(p) ?? "") >= v.date) continue;
      const days = day(W.checkEnd) - day(v.date);
      if (days < 150 || days > 365) continue;
      const x = follow.get(v.clinic) ?? { due: 0, overdue: 0 };
      if (days <= 240) x.due += 1;
      else x.overdue += 1;
      follow.set(v.clinic, x);
    }
    return { newPat, follow };
  } catch {
    return null;
  }
}

/** Pulls the maps from Cube. About fifteen queries; the result is cached for the day. */
async function pull(): Promise<GutData> {
  const by = ["clinic_id"];
  const q = (start: string, end: string, filters: unknown[] = [], extra: Record<string, string> = {}) =>
    ordersRows({ by, start, end, m: { n: "orders", rev: "revenue", ...extra }, filters: filters as never });
  // The order types that count as VW: every sample_test_type_v2 value that starts with VW (VW, VW+VA).
  const types = await ordersRows({ by: ["sample_test_type_v2"], start: W.revStart, end: W.revEnd, m: { n: "orders" } });
  const vwTypes = types.map(r => String(r[`${TABLE}[sample_test_type_v2]`] ?? "")).filter(t => /^VW/i.test(t));
  const [rev, vw, gzA, gzB, gz25, gz26, fz26, base26, ordMarOct, gzMarOct, ordB, gzLastRows, fam26] = await Promise.all([
    q(W.revStart, W.revEnd),
    vwTypes.length ? q(W.revStart, W.revEnd, [eq(`${O}.sample_test_type_v2`, ...vwTypes)]) : Promise.resolve([]),
    q(W.aStart, W.aEnd, [gzF]),
    q(W.bStart, W.bEnd, [gzF]),
    q(W.y25Start, W.y25End, [gzF]),
    q(W.revStart, W.checkEnd, [gzF]),
    q(W.revStart, W.checkEnd, [fzF]),
    q(W.revStart, W.checkEnd, [baseF]),
    q(W.aStart, W.bEnd),
    q(W.aStart, W.bEnd, [gzF]),
    q(W.bStart, W.bEnd),
    q(W.aStart, W.checkEnd, [gzF], { last: "last_order" }),
    ordersRows({ by, family: true, start: W.revStart, end: W.checkEnd, m: { n: "orders" } }),
  ]);
  const zoomers = new Map<string, Set<string>>();
  for (const r of fam26) {
    for (const f of splitFamilies(String(r["fact_order_tests_enriched[product_family]"] ?? ""))) {
      if (!/zoomer/i.test(f) || /gut zoomer|foundation zoomer/i.test(f)) continue;
      const s = zoomers.get(clin(r)) ?? new Set<string>();
      s.add(f);
      zoomers.set(clin(r), s);
    }
  }
  const gzLast = new Map<string, string>();
  for (const r of gzLastRows) {
    const v = String(r["[last]"] ?? "").slice(0, 10);
    if (clin(r) && v) gzLast.set(clin(r), v);
  }
  // Main provider per clinic: the customer with the most revenue Mar–Oct, then their credential, ZIP and state.
  const prov = await ordersRows({ by: ["clinic_id", "customer_id", "customer_credential"], start: W.aStart, end: W.bEnd, m: { rev: "revenue" } });
  const main = new Map<string, { id: string; cred: string; rev: number }>();
  for (const r of prov) {
    const c = clin(r);
    const rv = num(r, "rev");
    const cur = main.get(c);
    if (c && (!cur || rv > cur.rev)) main.set(c, { id: String(r[`${TABLE}[customer_id]`] ?? ""), cred: String(r[`${TABLE}[customer_credential]`] ?? ""), rev: rv });
  }
  const cust = await cubeRows({ dimensions: ["customers.customer_id", "customers.zipcode", "customers.state"] }, {
    "customers.customer_id": "customers[customer_id]", "customers.zipcode": "customers[zipcode]", "customers.state": "customers[state]",
  });
  const where = new Map(cust.map(r => [String(r["customers[customer_id]"] ?? ""), { zip: String(r["customers[zipcode]"] ?? ""), state: String(r["customers[state]"] ?? "") }]));
  const peer = new Map<string, { cred: string; zip3: string; state: string }>();
  for (const [c, m] of main) {
    const w = where.get(m.id);
    peer.set(c, { cred: credentialGroup(m.cred), zip3: (w?.zip ?? "").replace(/\D/g, "").slice(0, 3), state: (w?.state ?? "").toUpperCase() });
  }
  const patients = await pullPatients();
  return {
    rev: toMap(rev, "rev"), vwRev: toMap(vw, "rev"), gzA: toMap(gzA, "n"), gzB: toMap(gzB, "n"), gzARev: toMap(gzA, "rev"), gzLast,
    gz25: toMap(gz25, "n"), gz25Rev: toMap(gz25, "rev"), gz26: new Set([...toMap(gz26, "n")].filter(([, n]) => n > 0).map(([c]) => c)),
    fz26: new Set([...toMap(fz26, "n")].filter(([, n]) => n > 0).map(([c]) => c)), baseline26: new Set([...toMap(base26, "n")].filter(([, n]) => n > 0).map(([c]) => c)),
    zoomers26: new Map([...zoomers].map(([c, s]) => [c, [...s].sort()])), ordersMarOct: toMap(ordMarOct, "n"), gzMarOct: toMap(gzMarOct, "n"), ordersB: toMap(ordB, "n"), peer,
    newPat: patients?.newPat,
    follow: patients?.follow,
  };
}

export const gutLists = gatedAction({
  args: {},
  handler: async (ctx): Promise<{ ready: true; asOf: string; lists: GutLists; names: Record<string, { name: string; state: string; sales: string }> }> => {
    const key = `${viewerCfgKey(ctx) ?? ""}gutl2|${new Date().toISOString().slice(0, 10)}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, { key });
    if (hit) return JSON.parse(hit);
    const lists = buildLists(await pull());
    const ids = [...new Set([...lists.stopped, ...lists.similar, ...lists.lost, ...lists.noGut].map(r => r.clinic))];
    const ident = await resolveIdentities(ctx, ids, W.y25Start, W.checkEnd);
    const names: Record<string, { name: string; state: string; sales: string }> = {};
    for (const [c, i] of Object.entries(ident)) names[c] = { name: i.name, state: i.state, sales: i.sales };
    const result = { ready: true as const, asOf: W.checkEnd, lists, names };
    await ctx.runMutation(internal.ingest.putCache, { key, payload: JSON.stringify(result) });
    return result;
  },
});
