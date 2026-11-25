/**
 * Product launches (2026-11-24): how each new Baseline is doing against earlier launches at the same age, with the season taken out
 * (analytics/launchModel.ts, launchTracker.ts). Collapsed by default to one line; each launch is a card: its attach rate by launch week
 * against the band of earlier launches, status, clinics, and dollars. Hidden until the engine has the data.
 */
import { useState } from "react";
import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import "./launchtracker.css";

type Wk = { n: number; start: string; complete: boolean; holiday: boolean; orders: number; attach: number };
type Band = { n: number; p25: number; median: number; p75: number } | null;
type Launch = {
  family: string; parent: string; launch: string; fromLeadership: boolean; daysLive: number; orders: number;
  status: "too-early" | "ahead" | "on-track" | "behind" | "no-band" | "mature";
  trend: "rising" | "steady" | "falling" | null; trendRatio: number | null;
  weeks: Wk[]; band: Band[];
  lastScored: { n: number; attach: number; orders: number } | null;
  revenue: number; runRate: number | null; perOrder: number; potential: number | null; upside: number | null;
  tried: number | null; hadParent: number | null; eligible: number | null; rank: number;
};
type Summary = { ready: true; asOf: string; normalCompanyWeek: number; references: Array<{ family: string; launch: string; scored: number }>; launches: Launch[] } | { ready: false };

const STATUS: Record<Launch["status"], { word: string; color: string }> = {
  ahead: { word: "Ahead of earlier launches", color: "var(--vw-success)" },
  "on-track": { word: "On track", color: "var(--vw-blue)" },
  behind: { word: "Behind earlier launches", color: "var(--vw-error)" },
  "too-early": { word: "Too early to judge", color: "var(--text-tertiary)" },
  "no-band": { word: "No comparison yet", color: "var(--text-tertiary)" },
  mature: { word: "Past the launch window", color: "var(--text-tertiary)" },
};
const K = (x: number) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : Math.abs(x) >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${Math.round(x)}`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const num2 = (x: number) => x.toFixed(2);

/** Attach rate by launch week (line) over the band of earlier launches (shaded p25-p75, dashed median). Holiday weeks are shaded grey; the open week is hollow. */
function Spark({ l }: { l: Launch }) {
  const W = 300, H = 84, L = 6, R = 6, T = 8, B = 16;
  const n = Math.min(14, Math.max(l.weeks.length, 8));
  const ws = l.weeks.slice(0, n);
  const top = Math.max(0.5, ...ws.map(w => w.attach), ...l.band.slice(0, n).map(b => b?.p75 ?? 0)) * 1.1;
  const x = (i: number) => L + (i + 0.5) * ((W - L - R) / n);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const band = l.band.slice(0, n).map((b, i) => (b ? { i, b } : null)).filter((p): p is { i: number; b: NonNullable<Band> } => !!p);
  const area = band.length > 1 ? [...band.map(p => `${x(p.i)},${y(p.b.p75)}`), ...[...band].reverse().map(p => `${x(p.i)},${y(p.b.p25)}`)].join(" ") : null;
  const med = band.map(p => `${x(p.i)},${y(p.b.median)}`).join(" ");
  const line = ws.filter(w => w.complete && !w.holiday).map(w => `${x(w.n - 1)},${y(w.attach)}`).join(" ");
  const bw = (W - L - R) / n;
  return (
    <svg className="lt-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${l.family}: orders per 100 company orders by launch week, against earlier launches`}>
      {ws.filter(w => w.holiday).map(w => (
        <rect key={`h${w.n}`} x={x(w.n - 1) - bw / 2} y={T} width={bw} height={H - T - B} fill="var(--vw-gray-10)" opacity="0.7"><title>{`Week ${w.n} (${day(w.start)}): holiday week, not scored`}</title></rect>
      ))}
      {area ? <polygon points={area} fill="var(--vw-blue)" opacity="0.14" /> : null}
      {med ? <polyline points={med} fill="none" stroke="var(--vw-blue)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" /> : null}
      {line ? <polyline points={line} fill="none" stroke="var(--text-primary)" strokeWidth="1.6" /> : null}
      {ws.map(w => (
        <circle key={w.n} cx={x(w.n - 1)} cy={y(w.attach)} r={w.complete ? 2.6 : 3} fill={w.complete && !w.holiday ? "var(--text-primary)" : "var(--surface-card)"} stroke="var(--text-primary)" strokeWidth="1.2" opacity={w.holiday ? 0.4 : 1}>
          <title>{`Week ${w.n} (${day(w.start)}): ${w.orders} orders, ${num2(w.attach)} per 100 company orders${w.holiday ? " · holiday week, not scored" : !w.complete ? " · week still open" : ""}`}</title>
        </circle>
      ))}
      {ws.filter((_, i) => i === 0 || (i + 1) % 4 === 0).map(w => (
        <text key={`t${w.n}`} x={x(w.n - 1)} y={H - 3} textAnchor="middle" fontSize="9" fill="var(--text-tertiary)">{`wk ${w.n}`}</text>
      ))}
    </svg>
  );
}

function Card({ l }: { l: Launch }) {
  const s = STATUS[l.status];
  const early = l.status === "too-early";
  const band = l.lastScored ? l.band[l.lastScored.n - 1] : null;
  const share = l.tried && l.hadParent !== null ? Math.round((l.hadParent / l.tried) * 100) : null;
  return (
    <div className="lt-card">
      <div className="lt-top">
        <div>
          <div className="lt-name">{l.family}</div>
          <div className="lt-sub">
            Week {Math.ceil(l.daysLive / 7)} · from {day(l.launch)}{l.fromLeadership ? "" : " (first week of orders: confirm with leadership)"}
          </div>
        </div>
        <div className="lt-chips">
          {l.rank ? <span className="lt-focus" title="Ranked by the weekly dollars at stake">Focus #{l.rank}</span> : null}
          <span className="lt-pill" style={{ color: s.color, borderColor: s.color }}>{s.word}</span>
        </div>
      </div>
      <Spark l={l} />
      <ul className="lt-facts">
        {early ? (
          <li>{l.orders} orders so far. A rating needs 3 full non-holiday weeks and 30 orders; until then only the weekly pace is shown.</li>
        ) : l.status === "mature" ? (
          <li>{l.orders} orders since launch. It has passed its launch weeks, so it is judged like any other product family.</li>
        ) : l.lastScored ? (
          <li>
            Last scored week (week {l.lastScored.n}): <b>{num2(l.lastScored.attach)}</b> orders per 100 company orders
            {band ? <> against <b>{num2(band.p25)}–{num2(band.p75)}</b> for earlier launches at that age</> : null}
            {l.trend ? <> · <b className={`lt-${l.trend}`}>{l.trend === "rising" ? "▲ rising" : l.trend === "falling" ? "▼ falling" : "steady"}</b> vs the 2 weeks before</> : null}
          </li>
        ) : null}
        <li>
          {K(l.revenue)} so far{l.runRate !== null && !early ? <> · <b>{K(l.runRate)}</b> a week now</> : null}
          {!early && l.status !== "mature" && l.potential !== null ? (
            l.upside && l.upside > 0 ? <> · a typical launch would reach {K(l.potential)} a week (<b>+{K(l.upside)}</b> room)</> : <> · already above a typical launch ({K(l.potential)} a week)</>
          ) : null}
        </li>
        {l.tried !== null ? (
          <li>
            {l.tried} clinics tried it{l.eligible ? <> of {l.eligible.toLocaleString("en-US")} that ordered {l.parent} last year ({Math.round((l.tried / l.eligible) * 1000) / 10}%)</> : null}
            {share !== null ? <> · {share}% already order {l.parent}, so some of this may replace it</> : null}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function LaunchTracker() {
  const [open, setOpen] = useState(false);
  const res = useRcaQuery(api.launchTracker.summary, { password: pw() }) as Summary | undefined;
  if (!res || !res.ready || !res.launches.length) return null;
  const live = res.launches.filter(l => l.status !== "mature");
  const count = (s: Launch["status"]) => live.filter(l => l.status === s).length;
  const lead = res.launches.find(l => l.rank === 1);
  return (
    <div className="lt-wrap">
      <button type="button" className={`lt-toggle${open ? " is-open" : ""}`} aria-expanded={open} aria-controls="lt-panel" onClick={() => setOpen(o => !o)}
        title={open ? "Hide product launches" : "Show how the new Baselines are doing against earlier launches"}>
        <span className="lt-toggle-t">Product launches</span>
        <span className="lt-toggle-s">
          {live.length} launching
          {count("ahead") ? <> · <b style={{ color: "var(--vw-success)" }}>{count("ahead")} ahead</b></> : null}
          {count("on-track") ? <> · {count("on-track")} on track</> : null}
          {count("behind") ? <> · <b style={{ color: "var(--vw-error)" }}>{count("behind")} behind</b></> : null}
          {count("too-early") ? <> · {count("too-early")} too early</> : null}
          {lead ? <> · focus: <b>{lead.family}</b></> : null}
        </span>
        <span className="lt-toggle-c" aria-hidden>{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open ? (
        <div id="lt-panel" className="lt-panel">
          <p className="lt-lead">
            Each new product is compared with earlier launches at the same age, in orders per 100 company orders, so a holiday week or a slow month does not
            count against it. Shaded = the middle half of earlier launches; dashed = their median; grey columns = holiday weeks, not scored.
          </p>
          <div className="lt-grid">{res.launches.map(l => <Card key={l.family} l={l} />)}</div>
          <p className="lt-note">
            Earlier launches used: {res.references.map(r => `${r.family} (${day(r.launch)})`).join(", ")}. Orders are the dashboard's family orders (an order with several
            families counts in each, so products sold together lift each other); dollars split each order across its families. A launch needs 3 full non-holiday weeks and 30 orders
            before it is rated, and is rated on its last 2 of them. Normal company volume is about {Math.round(res.normalCompanyWeek).toLocaleString("en-US")} orders a
            week. The launch date is the first week with orders until leadership confirms it. Data through {res.asOf}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
