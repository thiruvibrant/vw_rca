/**
 * Momentum tile, top of the Overview: is the business speeding up or slowing down?
 * The engine's anomaly consensus model (analytics/momentumModel.ts, METRIC_DEFINITIONS.md §8) computes everything;
 * this only draws it. Hidden until the engine has a momentum read (older engines, or the first build failed).
 */
import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";

const GOOD = "var(--vw-success)";
const BAD = "var(--vw-error)";
const WARN = "var(--vw-warning)";

type Sign = -1 | 0 | 1;
type Win = { weeks: number; pct: number; yoy: number; z: number; sig: Sign; actual: number; expected: number };
type Week = { start: string; pct: number; actual: number; expected: number };
type Vote = { id: string; label: string; vote: Sign; detail: string };
type Driver = { key: string; label: string; gap: number; pct4: number | null; tag: "sustained" | "new" };
type Summary = {
  ready: true;
  asOf: string;
  weekEnd: string;
  usual: number;
  band: number;
  windows: Win[];
  weekly: Week[];
  thisWeek: { start: string; end: string; pct: number } | null;
  votes: Vote[];
  status: "alert" | "watch" | "normal";
  direction: Sign;
  patternSign: Sign;
  holidaySeason: boolean;
  headline: string;
  drivers: { states: Driver[]; reps: Driver[] };
};

const pctText = (x: number | null, d = 1) => (x === null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`);
const money = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "+";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}K` : `${s}$${Math.round(a)}`;
};
const plain = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`);
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function statusOf(m: Summary): { label: string; color: string; icon: string } {
  const s = m.patternSign || m.direction;
  if (m.status === "alert") return s > 0 ? { label: "Alert: rise", color: GOOD, icon: "▲" } : { label: "Alert: dip", color: BAD, icon: "▼" };
  if (m.status === "watch") return { label: s > 0 ? "Watch: rise" : "Watch: dip", color: WARN, icon: "●" };
  return { label: "Normal", color: "var(--vw-gray-40)", icon: "●" };
}

/** 16 weekly readings vs the usual pace, with the normal band (±2 weekly noise) shaded. One hover target per week. */
function Spark({ m }: { m: Summary }) {
  const W = 320;
  const H = 64;
  const ys = m.weekly.map(w => w.pct);
  const lo = Math.min(...ys, m.usual - 2 * m.band, 0);
  const hi = Math.max(...ys, m.usual + 2 * m.band, 0);
  const pad = (hi - lo) * 0.08 || 0.01;
  const y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const step = W / Math.max(m.weekly.length - 1, 1);
  const x = (i: number) => i * step;
  const path = ys.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="ev-mo-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Weekly pace vs usual, last ${m.weekly.length} weeks`}>
      <rect x={0} width={W} y={y(m.usual + 2 * m.band)} height={Math.max(y(m.usual - 2 * m.band) - y(m.usual + 2 * m.band), 0)} fill="var(--vw-gray-10)" />
      <line x1={0} x2={W} y1={y(m.usual)} y2={y(m.usual)} stroke="var(--vw-gray-40)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke="var(--text-secondary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {m.weekly.map((w, i) => (
        <rect key={w.start} x={x(i) - step / 2} width={step} y={0} height={H} fill="transparent">
          <title>{`Week of ${day(w.start)}: ${pctText(w.pct)} vs the usual pace (${plain(w.actual)} actual, ${plain(w.expected)} usual)`}</title>
        </rect>
      ))}
    </svg>
  );
}

function Drivers({ title, rows }: { title: string; rows: Driver[] }) {
  if (!rows.length) return null;
  return (
    <div className="ev-mo-drv">
      <span className="k">{title}</span>
      {rows.map(d => (
        <span key={d.key} className="d" title={`Last 4 weeks ${pctText(d.pct4)} vs its usual pace. ${d.tag === "sustained" ? "Also off over 16 weeks: a sustained change." : "Not off over 16 weeks: a new change."}`}>
          {d.label} <b className="mono">{money(d.gap)}</b> <em className={`t-${d.tag}`}>{d.tag}</em>
        </span>
      ))}
    </div>
  );
}

export function MomentumTile({ teamLead }: { teamLead?: string }) {
  const res = useRcaQuery(api.momentum.summary, { password: pw() }) as Summary | { ready: false } | undefined;
  if (!res || !res.ready) return null;
  const m = res;
  const st = statusOf(m);
  const fired = m.votes.filter(v => v.vote !== 0).length;
  return (
    <section className="ev-card ev-mo" data-tour="ov-momentum" aria-label="Momentum">
      <div className="ev-mo-head">
        <div>
          <div className="ev-mo-title">Momentum{teamLead ? " · company-wide" : ""}</div>
          <p className="ev-mo-line">{m.headline}</p>
        </div>
        <span className="ev-mo-pill" style={{ color: st.color, borderColor: st.color }}>
          <span aria-hidden>{st.icon}</span> {st.label}
        </span>
      </div>

      <div className="ev-mo-body">
        <div className="ev-mo-ladder">
          {m.windows.map(w => (
            <div
              key={w.weeks}
              className="ev-mo-chip"
              style={w.sig ? { borderColor: w.sig < 0 ? BAD : GOOD, background: `color-mix(in srgb, ${w.sig < 0 ? BAD : GOOD} 8%, var(--surface-card))` } : undefined}
              title={`${plain(w.actual)} actual vs ${plain(w.expected)} at the usual pace. ${w.sig ? "Outside its normal range." : "Within its normal range."}`}
            >
              <span className="k">Last {w.weeks} wk{w.weeks > 1 ? "s" : ""}</span>
              <span className="v">{pctText(w.pct)}</span>
              <span className="s">{pctText(w.yoy)} vs last year</span>
            </div>
          ))}
        </div>
        <div className="ev-mo-chart">
          <Spark m={m} />
          <div className="ev-mo-axis">
            <span>{day(m.weekly[0].start)}</span>
            <span>Grey band = normal week-to-week range</span>
            <span>wk to {day(m.weekEnd)}</span>
          </div>
        </div>
      </div>

      <div className="ev-mo-votes" aria-label="Checks">
        <span className="k">{fired} of {m.votes.length} checks agree</span>
        {m.votes.map(v => (
          <span key={v.id} className={`ev-mo-vote${v.vote ? " on" : ""}`} title={v.detail}>
            <span aria-hidden style={{ color: v.vote < 0 ? BAD : v.vote > 0 ? GOOD : "var(--vw-gray-40)" }}>{v.vote < 0 ? "▼" : v.vote > 0 ? "▲" : "·"}</span> {v.label}
          </span>
        ))}
      </div>

      {m.status !== "normal" ? (
        <div className="ev-mo-drivers">
          <Drivers title="States" rows={m.drivers.states} />
          <Drivers title="Reps" rows={m.drivers.reps} />
        </div>
      ) : null}

      <div className="ev-mo-foot">
        Pace = revenue vs the half-year before the last 16 weeks, with season and holidays taken out (last year's pattern).
        Alert when 3 of 5 checks agree, Watch at 2.{m.thisWeek ? ` This week so far (${day(m.thisWeek.start)}–${day(m.thisWeek.end)}): ${pctText(m.thisWeek.pct)}.` : ""}
      </div>
    </section>
  );
}
