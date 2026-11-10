/**
 * Momentum tiles, top of the Overview: are revenue and orders at their normal level for this time of year?
 * Two tiles in sales / executive language: how far off normal (last 4 weeks), for how long, and which way it's heading.
 * The engine computes everything (analytics/momentumModel.ts, METRIC_DEFINITIONS.md §8); this only draws it.
 * Pure view: no data fetching (MomentumTile.tsx fetches), so it can be rendered on its own.
 */

const GOOD = "var(--vw-success)";
const BAD = "var(--vw-error)";
const WARN = "var(--vw-warning)";

type Sign = -1 | 0 | 1;
type Light = "red" | "amber" | "green";
type Win = { weeks: number; pct: number };
type Week = { start: string; actual: number; expected: number };
type Read = {
  weekEnd: string;
  windows: Win[];
  weekly: Week[];
  size: { pct: number; range: number };
  streak: { weeks: number; capped: boolean };
  way: "improving" | "worsening" | "steady";
  side: Sign;
  light: Light;
  since: string | null;
};
type Driver = { key: string; label: string; gap: number; pct4: number | null; tag: "ongoing" | "new" };
export type Summary = {
  ready: true;
  summary: string;
  revenue: Read;
  orders: Read;
  drivers: { states: Driver[]; reps: Driver[] };
};

const pctText = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** Plain word, colour and icon for a light. A lasting rise is good news, so it is green. */
function look(light: Light, side: Sign) {
  if (light === "red") return side > 0 ? { word: "Growing", color: GOOD, icon: "▲" } : { word: "Dropping", color: BAD, icon: "▼" };
  if (light === "amber") return { word: "Watch", color: WARN, icon: "●" };
  return { word: "Normal", color: GOOD, icon: "●" };
}

/** The 4-week level over the last 26 weeks, with the normal range shaded; hover a week for its value. */
function Line({ r }: { r: Read }) {
  const W = 260;
  const H = 56;
  const roll = r.weekly
    .map((_, i, ws) => {
      const s = ws.slice(Math.max(0, i - 3), i + 1);
      const e = s.reduce((a, w) => a + w.expected, 0);
      return { start: ws[i].start, pct: e > 0 ? s.reduce((a, w) => a + w.actual, 0) / e - 1 : 0 };
    })
    .slice(-26);
  const ys = roll.map(x => x.pct);
  const lo = Math.min(...ys, -r.size.range) * 1.15;
  const hi = Math.max(...ys, r.size.range) * 1.15;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  const step = W / Math.max(roll.length - 1, 1);
  const path = ys.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="ev-mo-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Last 6 months vs normal">
      <rect x={0} width={W} y={y(r.size.range)} height={Math.max(y(-r.size.range) - y(r.size.range), 0)} fill="var(--vw-gray-10)" />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--vw-gray-40)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke={r.light === "green" ? "var(--text-secondary)" : look(r.light, r.side).color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {roll.map((x, i) => (
        <rect key={x.start} x={i * step - step / 2} width={step} y={0} height={H} fill="transparent">
          <title>{`4 weeks to week of ${day(x.start)}: ${pctText(x.pct)} vs normal`}</title>
        </rect>
      ))}
    </svg>
  );
}

const trend = { improving: "Getting better", worsening: "Getting worse", steady: "Holding steady" };

function Tile({ name, r }: { name: string; r: Read }) {
  const l = look(r.light, r.side);
  const off = r.light !== "green";
  return (
    <div className="ev-card ev-mo-tile">
      <div className="ev-mo-top">
        <span>{name}</span>
        <span className="ev-mo-pill" style={{ color: l.color, borderColor: l.color }}><span aria-hidden>{l.icon}</span> {l.word}</span>
      </div>
      <div className="ev-mo-big">{pctText(r.size.pct)}</div>
      <div className="ev-mo-sub">vs normal for this time of year · last 4 weeks</div>
      <ul className="ev-mo-facts">
        <li>
          {off
            ? `${r.side < 0 ? "Below" : "Above"} normal ${r.streak.weeks}${r.streak.capped ? "+" : ""} weeks in a row${r.since ? ` (since ${day(r.since)})` : ""}`
            : `Within the normal range (±${(r.size.range * 100).toFixed(1)}%)`}
        </li>
        <li>Trend: {trend[r.way]}</li>
      </ul>
      <Line r={r} />
      <div className="ev-mo-cap">Last 6 months · grey band = normal range</div>
      <div className="ev-mo-wins">
        {r.windows.map(w => (
          <span key={w.weeks} className={w.weeks === 4 ? "is-main" : undefined}>
            {w.weeks === 1 ? "Last week" : `${w.weeks} wks`} <b>{pctText(w.pct)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Drop({ title, rows }: { title: string; rows: Driver[] }) {
  if (!rows.length) return null;
  return (
    <div className="ev-mo-drv">
      <span className="k">{title}</span>
      {rows.map(d => (
        <span key={d.key} className="d" title={d.tag === "ongoing" ? "Has been off for months" : "Started recently"}>
          {d.label} <b className="mono">{d.gap >= 0 ? "+" : "−"}{int(Math.abs(d.gap))}</b>
        </span>
      ))}
    </div>
  );
}

export function MomentumView({ m, teamLead }: { m: Summary; teamLead?: string }) {
  const ordersOff = m.orders.light !== "green";
  return (
    <section className="ev-mo" data-tour="ov-momentum" aria-label="Momentum">
      <div>
        <div className="ev-mo-title">How are we trending?{teamLead ? " · company-wide" : ""} · to {day(m.revenue.weekEnd)}</div>
        <p className="ev-mo-line">{m.summary}</p>
      </div>
      <div className="ev-mo-grid">
        <Tile name="Revenue" r={m.revenue} />
        <Tile name="Orders" r={m.orders} />
      </div>
      {ordersOff ? (
        <div className="ev-mo-drivers">
          <div className="ev-mo-title">{m.orders.side < 0 ? "Biggest drops" : "Biggest gains"} in orders · last 4 weeks vs normal</div>
          <Drop title="States" rows={m.drivers.states} />
          <Drop title="Reps" rows={m.drivers.reps} />
        </div>
      ) : null}
      <div className="ev-mo-foot">
        Normal = the usual level for this time of year, based on the last 6 months with seasonal and holiday effects taken out.
        Dropping / Growing = outside the normal range for 5+ weeks. Watch = outside it recently, or drifting for 6+ weeks.
      </div>
    </section>
  );
}
