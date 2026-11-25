/**
 * New launches, relaunches and variants by test version (2026-11-25; analytics/productVersions.ts, versionModel.ts). The product family
 * strips version numbers and variants ("Nutrient Baseline 2.0" counts in Nutrient Baseline), so these show what changed inside a family:
 *  - `useVersions` + `versionBadge`: one line for a family tile ("2.0 relaunched Nov 9", "+ Male version Nov 9", "New Aug 24").
 *  - `VersionPanel`: weekly orders stacked by version with a marker at each start, and one line per start on what it did to the family.
 * Hidden until the engine has the data (it needs the Cube dimension order_tests.test_version).
 */
import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import "./familyversions.css";

type Read = "too-early" | "grew" | "flat" | "fell" | "no-history";
export type VersionEvent = {
  base: string; name: string; label: string; kind: "new" | "relaunch" | "variant"; start: string; official: boolean; preOrders: number;
  orders: number; share: number; replaces: string[];
  read: { before: { p25: number; median: number; p75: number; weeks: number } | null; since: number | null; scored: number; lift: number | null; read: Read };
};
export type VersionBase = { base: string; events: VersionEvent[]; weekly: Array<{ week: string; partial: boolean; holiday: boolean; byVersion: Record<string, number> }>; versions: string[] };
export type Health = { base: string; status: "behind" | "ahead" | "on-trend"; recent: number; range: { p25: number; median: number; p75: number; weeks: number }; vsMedian: number };
type Summary = { ready: true; asOf: string; bases: VersionBase[]; health: Health[] } | { ready: false };
/** The launch tracker's row for a tracked launch (analytics/launchTracker.ts), the parts the status line needs. */
type LaunchRow = {
  family: string; launch: string; relaunch: boolean; daysLive: number;
  status: "too-early" | "ahead" | "on-track" | "behind" | "no-band" | "mature";
  trend: "rising" | "steady" | "falling" | null;
  lastScored: { n: number; attach: number; orders: number } | null;
  band: Array<{ n: number; p25: number; median: number; p75: number } | null>;
  ownRange: { p25: number; median: number; p75: number; weeks: number } | null;
  revenue: number; runRate: number | null; potential: number | null; upside: number | null;
};
type LaunchSummary = { ready: true; launches: LaunchRow[] } | { ready: false };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const BADGE_DAYS = 120;

/** Version data per family (the cleaned test name is the family's name). Empty until the engine has it. */
export function useVersions(): { asOf: string; byFamily: Map<string, VersionBase>; health: Map<string, Health>; launches: Map<string, LaunchRow> } {
  const res = useRcaQuery(api.productVersions.summary, { password: pw() }) as Summary | undefined;
  const lt = useRcaQuery(api.launchTracker.summary, { password: pw() }) as LaunchSummary | undefined;
  const launches = new Map<string, LaunchRow>(lt && lt.ready ? lt.launches.map(l => [l.family, l] as [string, LaunchRow]) : []);
  if (!res || !res.ready) return { asOf: "", byFamily: new Map(), health: new Map(), launches };
  return { asOf: res.asOf, byFamily: new Map(res.bases.map(b => [b.base, b])), health: new Map(res.health.map(h => [h.base, h])), launches };
}

const ageDays = (start: string, asOf: string) => Math.round((Date.parse(asOf) - Date.parse(start)) / 864e5);

/** One short line for a family tile: its starts in the last 120 days, newest first (at most two). */
export function versionBadge(b: VersionBase | undefined, asOf: string): string | null {
  if (!b) return null;
  const recent = b.events.filter(e => ageDays(e.start, asOf) <= BADGE_DAYS).slice(0, 2);
  if (!recent.length) return null;
  return recent.map(e => (e.kind === "relaunch" ? `${e.label} relaunched ${day(e.start)}` : e.kind === "variant" ? `+ ${e.label} version ${day(e.start)}` : `new ${day(e.start)}`)).join(" · ");
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

/** One sentence on what a start did to the family, season-free (orders per 100 company orders). */
export function eventLine(e: VersionEvent): string {
  const r = e.read;
  const when = `${day(e.start)}${e.official ? "" : " (date read from the orders: confirm)"}`;
  const what =
    e.kind === "relaunch" ? `${e.name} replaced ${e.replaces.join(" and ") || "the earlier version"} on ${when}`
    : e.kind === "variant" ? `${e.name} added on ${when} next to ${e.replaces.join(" and ") || "the existing version"}; ${Math.round(e.share * 100)}% of the family's orders since`
    : `${e.name} launched ${when}`;
  if (r.read === "no-history") return `${what}. No earlier history to compare with${e.kind === "new" ? " (the Product launches panel compares it with earlier launches)" : ""}.`;
  const nums = r.before && r.since !== null ? `${r.since.toFixed(2)} per 100 company orders since vs ${r.before.median.toFixed(2)} in the ${r.before.weeks} weeks before (${pct(r.lift ?? 0)})` : "";
  const verdict =
    r.read === "too-early" ? `too early to call: ${r.scored} full week${r.scored === 1 ? "" : "s"} so far, 3 needed`
    : r.read === "grew" ? "the family grew"
    : r.read === "fell" ? "the family fell"
    : e.kind === "variant" ? "the family is flat: the new version mostly split existing orders"
    : "the family is flat: same demand, new version";
  return `${what}. ${nums}${nums ? "; " : ""}${verdict}.`;
}

/** Earlier versions grey, the newest start blue, any other version selling next to it ink. */
function colorOf(b: VersionBase, name: string): string {
  const newest = b.events[0]?.name;
  if (name === newest) return "var(--vw-blue)";
  if (b.events.some(e => e.name === name)) return "var(--vw-ink)";
  return "var(--vw-gray-30)";
}

export function VersionPanel({ b }: { b: VersionBase }) {
  // One label row per start above the bars, so two starts close together never overlap.
  const rows = Math.max(1, b.events.length);
  const W = 560, L = 40, R = 10, T = 8 + 13 * rows, B = 24, H = 172 + T;
  const ws = b.weekly;
  const tot = (w: (typeof ws)[number]) => Object.values(w.byVersion).reduce((t, n) => t + n, 0);
  const max = Math.max(1, ...ws.map(tot));
  const bw = (W - L - R) / Math.max(1, ws.length);
  const x = (i: number) => L + i * bw;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  // Oldest version at the bottom of each stack.
  const rank = (n: string) => ["var(--vw-gray-30)", "var(--vw-ink)", "var(--vw-blue)"].indexOf(colorOf(b, n));
  const order = [...b.versions].sort((a, c) => rank(a) - rank(c));
  const every = Math.max(1, Math.ceil(ws.length / 8));
  const shown = (name: string) => b.events.find(e => e.name === name)?.label ?? (name === b.base ? "original" : name);
  return (
    <div className="fv">
      <div className="fv-head">
        <div className="fv-title">By test version: orders per week</div>
        <div className="fv-legend">
          {order.map(n => (
            <span key={n}><i style={{ background: colorOf(b, n) }} />{n}</span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="fv-chart" role="img" aria-label={`${b.base}: weekly orders by test version`}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="var(--vw-gray-10)" strokeWidth={1} />
            <text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize={10} fill="var(--text-tertiary)">{Math.round(max * f)}</text>
          </g>
        ))}
        {ws.map((w, i) => {
          let acc = 0;
          return (
            <g key={w.week} opacity={w.partial ? 0.45 : 1}>
              {order.map(n => {
                const v = w.byVersion[n] ?? 0;
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return (
                  <rect key={n} x={x(i) + 1} y={y1 + 1} width={Math.max(1, bw - 2)} height={Math.max(0, y0 - y1 - 1)} fill={colorOf(b, n)} rx={1}>
                    <title>{`Week of ${day(w.week)}: ${n} ${v} orders (family ${tot(w)})${w.partial ? " · week still open" : ""}${w.holiday ? " · holiday week" : ""}`}</title>
                  </rect>
                );
              })}
              {i % every === 0 ? <text x={x(i) + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-tertiary)">{day(w.week)}</text> : null}
            </g>
          );
        })}
        {b.events.map((e, k) => {
          // The week holding the start; a start before the chart's first week has no marker.
          const i = ws.reduce((k, w, j) => (w.week <= e.start ? j : k), -1);
          if (i < 0) return null;
          const fx = x(i) + ((Date.parse(e.start) - Date.parse(ws[i].week)) / 864e5 / 7) * bw;
          return (
            <g key={e.name}>
              <line x1={fx} x2={fx} y1={4 + 13 * k} y2={H - B} stroke="var(--text-primary)" strokeWidth={1} strokeDasharray="3 3" />
              <text x={fx > W - 160 ? fx - 4 : fx + 4} y={13 + 13 * k} fontSize={10} fill="var(--text-primary)" textAnchor={fx > W - 160 ? "end" : "start"}>
                {`${shown(e.name)} ${e.kind === "relaunch" ? "relaunch" : e.kind === "variant" ? "added" : "launch"} ${day(e.start)}`}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="fv-lines">
        {b.events.map(e => (
          <li key={e.name}>
            <b className={`fv-k fv-k-${e.kind}`}>{e.kind === "relaunch" ? "Relaunch" : e.kind === "variant" ? "New version" : "New"}</b> {eventLine(e)}
            {e.preOrders > 0 ? ` ${e.preOrders} order${e.preOrders === 1 ? "" : "s"} dated before the official start are left out.` : ""}
          </li>
        ))}
      </ul>
      <div className="fv-note">
        Versions come from the raw test name, which keeps "2.0" or "Male"; the family adds them up. Orders here are orders holding that test
        version. Season-free reading: the family's orders per 100 company orders, holiday weeks not scored, 3 full weeks needed. Recent weeks
        can still rise as late orders post; the faded bar is the open week.
      </div>
    </div>
  );
}

const BLINK_DAYS = 60;
type V = ReturnType<typeof useVersions>;

/** The marker on a family tile: blinking for a new or relaunched product (last 60 days), "behind trend" for an established family below its own range. */
export function tileMark(family: string, v: V): "blink" | "behind" | null {
  const b = v.byFamily.get(family);
  const fresh = b?.events.some(e => e.kind !== "variant" && ageDays(e.start, v.asOf) <= BLINK_DAYS);
  const l = v.launches.get(family);
  if (fresh || (l && l.status !== "mature" && l.daysLive <= BLINK_DAYS)) return "blink";
  return v.health.get(family)?.status === "behind" ? "behind" : null;
}

export type Tone = "ahead" | "on" | "behind" | "early";
const K = (x: number) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : Math.abs(x) >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${Math.round(x)}`);
const n2 = (x: number) => x.toFixed(2);

/**
 * Ahead / on track / behind / too early for a family, and the lines under it. A tracked launch or relaunch uses the launch tracker (against
 * earlier launches at the same age, or its own range for a relaunch); another recent start uses its own read (versionModel.readOf);
 * an established family is read against its own last 13 weeks (healthOf). All season-free: orders per 100 company orders.
 */
export function familyStatus(family: string, v: V): { tone: Tone; word: string; lines: string[] } | null {
  const l = v.launches.get(family);
  if (l && l.status !== "mature" && l.status !== "no-band") {
    const tone: Tone = l.status === "ahead" ? "ahead" : l.status === "behind" ? "behind" : l.status === "on-track" ? "on" : "early";
    const word = { ahead: "Ahead", "on-track": "On track", behind: "Behind", "too-early": "Too early to judge" }[l.status as "ahead" | "on-track" | "behind" | "too-early"];
    const vs = l.relaunch ? "its own range before the relaunch" : "earlier launches at the same age";
    const lines: string[] = [];
    if (l.status === "too-early") lines.push(`${l.daysLive} days since ${day(l.launch)}. A rating needs 3 full non-holiday weeks and 30 orders; until then only the weekly pace is shown.`);
    else if (l.lastScored) {
      const b = l.relaunch && l.ownRange ? l.ownRange : l.band[l.lastScored.n - 1];
      lines.push(`Last scored week (week ${l.lastScored.n}): ${n2(l.lastScored.attach)} orders per 100 company orders${b ? ` against ${n2(b.p25)}–${n2(b.p75)} for ${vs}` : ""}${l.trend ? `; ${l.trend} against the 2 weeks before` : ""}.`);
    }
    if (l.runRate !== null) lines.push(`${K(l.revenue)} so far, ${K(l.runRate)} a week now${l.potential !== null && l.status !== "too-early" ? (l.upside && l.upside > 0 ? `; a typical launch would reach ${K(l.potential)} a week (${K(l.upside)} of room)` : `; already above a typical launch (${K(l.potential)} a week)`) : ""}.`);
    return { tone, word, lines };
  }
  const b = v.byFamily.get(family);
  const e = b?.events.find(x => ageDays(x.start, v.asOf) <= 120);
  if (e) {
    const r = e.read.read;
    if (r === "too-early" || r === "no-history") return { tone: "early", word: "Too early to judge", lines: [eventLine(e)] };
    return { tone: r === "grew" ? "ahead" : r === "fell" ? "behind" : "on", word: r === "grew" ? "Ahead" : r === "fell" ? "Behind" : "On track", lines: [eventLine(e)] };
  }
  const h = v.health.get(family);
  if (!h) return null;
  return {
    tone: h.status === "ahead" ? "ahead" : h.status === "behind" ? "behind" : "on",
    word: h.status === "ahead" ? "Ahead of its trend" : h.status === "behind" ? "Behind its trend" : "On its trend",
    lines: [`Last 2 full weeks: ${n2(h.recent)} orders per 100 company orders (${pct(h.vsMedian)} vs the median) against its own range of ${n2(h.range.p25)}–${n2(h.range.p75)} over the ${h.range.weeks} weeks before. The season is taken out: holiday weeks are not scored.`],
  };
}

const TONE_COLOR: Record<Tone, string> = { ahead: "var(--vw-success)", on: "var(--vw-blue)", behind: "var(--vw-error)", early: "var(--text-tertiary)" };

/** Status pill and its lines, for the top of a family's chart. */
export function StatusBlock({ family, v }: { family: string; v: V }) {
  const st = familyStatus(family, v);
  if (!st) return null;
  return (
    <div className="fv-status">
      <span className="fv-pill" style={{ color: TONE_COLOR[st.tone], borderColor: TONE_COLOR[st.tone] }}>{st.word}</span>
      <div className="fv-status-t">{st.lines.map((t, i) => <div key={i}>{t}</div>)}</div>
    </div>
  );
}
