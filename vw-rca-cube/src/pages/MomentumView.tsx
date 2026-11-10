/**
 * Momentum tiles, top of the Overview: is the business speeding up or slowing down?
 * Revenue, Orders (volume: a price change can't move it) and Average order value, each answering three plain questions:
 * how big (last 4 weeks vs the normal range), how long (weeks in a row), which way (vs the 4 weeks before).
 * The engine computes everything (analytics/momentumModel.ts, METRIC_DEFINITIONS.md §8); this only draws it.
 * Pure view: no data fetching (MomentumTile.tsx fetches), so it can be rendered on its own.
 */

const GOOD = "var(--vw-success)";
const BAD = "var(--vw-error)";
const WARN = "var(--vw-warning)";

type Sign = -1 | 0 | 1;
type Light = "red" | "amber" | "green";
type Win = { weeks: number; pct: number; yoy: number };
type Week = { start: string; actual: number; expected: number; pct: number };
type LightWeek = { weekEnd: string; light: Light; side: Sign };
type Read = {
  weekEnd: string;
  windows: Win[];
  weekly: Week[];
  thisWeek: { start: string; end: string; pct: number } | null;
  size: { pct: number; range: number; outside: boolean };
  streak: { weeks: number; capped: boolean };
  way: "improving" | "worsening" | "steady";
  side: Sign;
  light: Light;
  holidaySeason: boolean;
  history: LightWeek[];
  since: string | null;
};
type Driver = { key: string; label: string; gap: number; pct4: number | null; tag: "ongoing" | "new" };
export type Summary = {
  ready: true;
  asOf: string;
  summary: string;
  revenue: Read;
  orders: Read;
  orderValue: { now: number; ly: number; yoy: number; change: number; way: "steady" | "up" | "down"; weekly: { start: string; value: number }[] };
  drivers: { states: Driver[]; reps: Driver[] };
};

const pctText = (x: number | null, d = 1) => (x === null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`);
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** Meaning, colour and icon of a light. A lasting rise is good news, so it is green, not red. */
function look(light: Light, side: Sign): { word: string; color: string; icon: string; tint: number } {
  if (light === "red") return side > 0 ? { word: "Rising", color: GOOD, icon: "▲", tint: 100 } : { word: "Falling", color: BAD, icon: "▼", tint: 100 };
  if (light === "amber") return { word: "Watch", color: WARN, icon: "●", tint: 100 };
  return { word: "Normal", color: GOOD, icon: "●", tint: 35 };
}

function Pill({ light, side }: { light: Light; side: Sign }) {
  const l = look(light, side);
  return (
    <span className="ev-mo-pill" style={{ color: l.color, borderColor: l.color }}>
      <span aria-hidden>{l.icon}</span> {l.word}
    </span>
  );
}

/** Rolling 4-week pace for the last 26 weeks, with the normal range shaded; one hover target per week. */
function PaceLine({ r }: { r: Read }) {
  const W = 260;
  const H = 54;
  const weeks = r.weekly;
  const roll = weeks.map((_, i) => {
    const ws = weeks.slice(Math.max(0, i - 3), i + 1);
    const e = ws.reduce((s, w) => s + w.expected, 0);
    return { start: weeks[i].start, pct: e > 0 ? ws.reduce((s, w) => s + w.actual, 0) / e - 1 : 0 };
  }).slice(-26);
  const ys = roll.map(x => x.pct);
  const lo = Math.min(...ys, -r.size.range) * 1.15;
  const hi = Math.max(...ys, r.size.range) * 1.15;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  const step = W / Math.max(roll.length - 1, 1);
  const path = ys.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const line = look(r.light, r.side).color;
  return (
    <svg className="ev-mo-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="4-week pace vs usual, last 26 weeks">
      <rect x={0} width={W} y={y(r.size.range)} height={Math.max(y(-r.size.range) - y(r.size.range), 0)} fill="var(--vw-gray-10)" />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--vw-gray-40)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke={r.light === "green" ? "var(--text-secondary)" : line} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {roll.map((x, i) => (
        <rect key={x.start} x={i * step - step / 2} width={step} y={0} height={H} fill="transparent">
          <title>{`4 weeks to week of ${day(x.start)}: ${pctText(x.pct)} vs usual`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** One square per week for the last 52 weeks, coloured by that week's light. */
function Strip({ history }: { history: LightWeek[] }) {
  return (
    <div className="ev-mo-strip" role="img" aria-label="Weekly status, last 52 weeks">
      {history.map(h => {
        const l = look(h.light, h.side);
        return <i key={h.weekEnd} title={`Week to ${day(h.weekEnd)}: ${l.word}`} style={{ background: `color-mix(in srgb, ${l.color} ${l.tint}%, var(--surface-card))` }} />;
      })}
    </div>
  );
}

function ValueLine({ weekly }: { weekly: { start: string; value: number }[] }) {
  const W = 260;
  const H = 54;
  const ys = weekly.map(w => w.value).filter(v => v > 0);
  if (ys.length < 2) return null;
  const lo = Math.min(...ys) * 0.98;
  const hi = Math.max(...ys) * 1.02;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  const step = W / Math.max(weekly.length - 1, 1);
  const path = weekly.map((w, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(w.value || lo).toFixed(1)}`).join(" ");
  return (
    <svg className="ev-mo-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Average order value, last 52 weeks">
      <path d={path} fill="none" stroke="var(--text-secondary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {weekly.map((w, i) => (
        <rect key={w.start} x={i * step - step / 2} width={step} y={0} height={H} fill="transparent">
          <title>{`Week of ${day(w.start)}: $${w.value.toFixed(0)} per order`}</title>
        </rect>
      ))}
    </svg>
  );
}

const wayText = { improving: "Improving vs the 4 weeks before", worsening: "Worsening vs the 4 weeks before", steady: "Steady vs the 4 weeks before" };

function PaceTile({ name, r, extra }: { name: string; r: Read; extra?: string }) {
  const side = r.side < 0 ? "below" : "above";
  const others = r.windows.filter(w => w.weeks !== 4);
  return (
    <div className="ev-card ev-mo-tile">
      <div className="ev-mo-top"><span>{name}</span><Pill light={r.light} side={r.side} /></div>
      <div className="ev-mo-big">{pctText(r.size.pct)}</div>
      <div className="ev-mo-sub">vs usual pace · last 4 weeks · normal range ±{(r.size.range * 100).toFixed(1)}%</div>
      <ul className="ev-mo-facts">
        <li><b>How long:</b> {r.streak.weeks}{r.streak.capped ? "+" : ""} week{r.streak.weeks === 1 ? "" : "s"} in a row {side} usual{r.since ? ` · off usual since ${day(r.since)}` : ""}</li>
        <li><b>Which way:</b> {wayText[r.way]}</li>
        {extra ? <li>{extra}</li> : null}
      </ul>
      <div className="ev-mo-cap">4-week pace, last 26 weeks · grey band = normal range · squares = each of the last 52 weeks</div>
      <PaceLine r={r} />
      <Strip history={r.history} />
      <div className="ev-mo-wins">{others.map(w => <span key={w.weeks}>{w.weeks} wk{w.weeks > 1 ? "s" : ""} <b>{pctText(w.pct)}</b></span>)}</div>
    </div>
  );
}

function Drivers({ title, rows }: { title: string; rows: Driver[] }) {
  if (!rows.length) return null;
  return (
    <div className="ev-mo-drv">
      <span className="k">{title}</span>
      {rows.map(d => (
        <span key={d.key} className="d" title={`Last 4 weeks ${pctText(d.pct4)} vs its usual pace. ${d.tag === "ongoing" ? "Also off over 16 weeks: an ongoing change." : "Not off over 16 weeks: a new change."}`}>
          {d.label} <b className="mono">{d.gap >= 0 ? "+" : "−"}{int(Math.abs(d.gap))} orders</b> <em>{d.tag}</em>
        </span>
      ))}
    </div>
  );
}

/** The tiles for a momentum read (no data fetching, so it can be rendered on its own). */
export function MomentumView({ m, teamLead }: { m: Summary; teamLead?: string }) {
  const v = m.orderValue;
  const o4 = m.orders.windows.find(w => w.weeks === 4);
  const ordersOff = m.orders.light !== "green";
  return (
    <section className="ev-mo" data-tour="ov-momentum" aria-label="Momentum">
      <div className="ev-mo-head">
        <div className="ev-mo-title">Momentum{teamLead ? " · company-wide" : ""} · weeks to {day(m.revenue.weekEnd)}</div>
        <p className="ev-mo-line">{m.summary}</p>
      </div>

      <div className="ev-mo-grid">
        <PaceTile name="Revenue" r={m.revenue} />
        <PaceTile name="Orders (volume)" r={m.orders} extra={o4 ? `vs last year: ${pctText(o4.yoy)} (unaffected by price)` : undefined} />
        <div className="ev-card ev-mo-tile">
          <div className="ev-mo-top"><span>Avg order value</span><span className="ev-mo-pill" style={{ color: "var(--text-tertiary)", borderColor: "var(--border-subtle)" }}>Price &amp; mix</span></div>
          <div className="ev-mo-big">${v.now.toFixed(0)}</div>
          <div className="ev-mo-sub">per order · last 4 weeks</div>
          <ul className="ev-mo-facts">
            <li><b>vs last year:</b> {pctText(v.yoy)} (${v.ly.toFixed(0)} then)</li>
            <li><b>Which way:</b> {v.way === "steady" ? "Steady" : v.way === "up" ? `Up ${pctText(v.change)}` : `Down ${pctText(v.change)}`} vs the 12 weeks before</li>
          </ul>
          <div className="ev-mo-cap">Order value per week, last 52 weeks</div>
          <ValueLine weekly={v.weekly} />
          <div className="ev-mo-wins"><span>Revenue = orders × order value</span></div>
        </div>
      </div>

      {ordersOff ? (
        <div className="ev-mo-drivers">
          <div className="ev-mo-title">Where the change in orders comes from · last 4 weeks vs usual</div>
          <Drivers title="States" rows={m.drivers.states} />
          <Drivers title="Reps" rows={m.drivers.reps} />
        </div>
      ) : null}

      <div className="ev-mo-foot">
        <span className="ev-mo-key"><i style={{ background: `color-mix(in srgb, ${GOOD} 35%, var(--surface-card))` }} /> Normal: inside the normal range</span>
        <span className="ev-mo-key"><i style={{ background: WARN }} /> Watch: outside the range, or 6+ weeks one way</span>
        <span className="ev-mo-key"><i style={{ background: BAD }} /> Falling / <i style={{ background: GOOD }} /> Rising: outside the range and 5+ weeks one way</span>
        <span>Usual pace = the half-year before the last 16 weeks, with season and holidays taken out.{m.revenue.thisWeek ? ` This week so far: revenue ${pctText(m.revenue.thisWeek.pct)}, orders ${pctText(m.orders.thisWeek?.pct ?? 0)}.` : ""}</span>
      </div>
    </section>
  );
}
