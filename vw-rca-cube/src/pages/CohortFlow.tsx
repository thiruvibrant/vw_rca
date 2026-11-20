/**
 * "Cohort movement · last 12 months" (2026-11-20): month by month, how many clinics moved up to the Top 20% list, down to
 * the rest, into Churned and back, and the revenue they carry (analytics/cohortFlow.ts). Collapsed by default to one line
 * with the latest month; click a number for those clinics. Used on the overview (company or a team lead) and in the rep
 * view (a rep or a team).
 */
import { useState } from "react";
import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import "./cohortflow.css";

type Group = "up" | "down" | "churn" | "back";
type FlowRow = { from: string; to: string; labelled: number; first: number; bounced: number; groups: Record<Group, { n: number; rev: number }> };
type Summary = { ready: true; dataThrough: string; clinics: number; rows: FlowRow[] } | { ready: false };
type Cell = { from: string; to: string; group: Group; title: string };
type ClinicRow = { clinic: string; name: string; sales: string; before?: string; after?: string; rev: number; revMonth: string };

const LABEL: Record<string, string> = {
  retained_top20: "Active · top 20%",
  retained_rest: "Active · rest",
  new: "Active · new",
  reactivated: "Reactivated",
  churned: "Churned",
};
const COLS: Array<{ g: Group; head: string; sub: string; good: boolean }> = [
  { g: "up", head: "▲ Up to Top 20%", sub: "from Active · rest", good: true },
  { g: "back", head: "▲ Back from Churned", sub: "ordering again", good: true },
  { g: "down", head: "▼ Down to rest", sub: "off the Top 20% list", good: false },
  { g: "churn", head: "▼ Into Churned", sub: "past their own churn line", good: false },
];

const K = (x: number) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : Math.abs(x) >= 1e3 ? `$${Math.round(x / 1e3)}K` : `$${Math.round(x)}`);
const int = (x: number) => x.toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isMonthEnd = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).getUTCDate() === 1;
/** The month a row covers: "Oct 2026", or "Nov 1–19" while the month is running. */
const monthOf = (r: FlowRow) => {
  const m = MONTHS[+r.to.slice(5, 7) - 1];
  return isMonthEnd(r.to) ? `${m} ${r.to.slice(0, 4)}` : `${m} 1–${+r.to.slice(8, 10)} (to date)`;
};
const net = (r: FlowRow) => r.groups.up.n + r.groups.back.n - r.groups.down.n - r.groups.churn.n;

export function CohortFlow({ sales, teamLead, scopeLabel }: { sales?: string; teamLead?: string; scopeLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [cell, setCell] = useState<Cell | null>(null);
  const res = useRcaQuery(api.cohortFlow.summary, { password: pw(), sales, teamLead }) as Summary | undefined;
  const list = useRcaQuery(
    api.cohortFlow.clinics,
    cell ? { password: pw(), sales, teamLead, from: cell.from, to: cell.to, group: cell.group } : "skip",
  ) as { ready: boolean; total: number; rows: ClinicRow[] } | undefined;
  if (!res || !res.ready || !res.rows.length) return null;
  const last = res.rows[0];
  return (
    <div className="cf-wrap">
      <button
        type="button"
        className={`cf-toggle${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls="cf-panel"
        onClick={() => setOpen(o => !o)}
        title={open ? "Hide cohort movement" : "Show how clinics moved between cohorts, month by month, for the last 12 months"}
      >
        <span className="cf-toggle-t">Cohort movement · last 12 months</span>
        <span className="cf-toggle-s">
          {monthOf(last)}: <b className="cf-good">▲ {int(last.groups.up.n + last.groups.back.n)}</b> · <b className="cf-bad">▼ {int(last.groups.down.n + last.groups.churn.n)}</b>
        </span>
        <span className="cf-toggle-c" aria-hidden>{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open ? (
        <div id="cf-panel" className="cf-panel">
          <p className="cf-lead">
            {scopeLabel ?? "Company-wide"}: each clinic's cohort at every month-end, compared with the month-end before. Click a number for those clinics.
          </p>
          <div className="cf-scroll">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Month</th>
                  {COLS.map(c => (
                    <th key={c.g}>
                      {c.head}
                      <span>{c.sub}</span>
                    </th>
                  ))}
                  <th>
                    Net
                    <span>clinics up − down</span>
                  </th>
                  <th>
                    First order
                    <span>new clinics</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {res.rows.map(r => (
                  <tr key={r.to}>
                    <th scope="row">{monthOf(r)}</th>
                    {COLS.map(c => {
                      const g = r.groups[c.g];
                      const on = cell && cell.to === r.to && cell.group === c.g;
                      return (
                        <td key={c.g}>
                          {g.n ? (
                            <button
                              type="button"
                              className={`cf-cell${on ? " is-on" : ""}`}
                              onClick={() => setCell(on ? null : { from: r.from, to: r.to, group: c.g, title: `${c.head.replace(/^[▲▼] /, "")} · ${monthOf(r)}` })}
                            >
                              <b className={c.good ? "cf-good" : "cf-bad"}>{int(g.n)}</b>
                              <span>{K(g.rev)}</span>
                              {c.g === "churn" && r.bounced ? <em title="Churned at this month-end and ordering again by one of the next two">{int(r.bounced)} back within 2 mo</em> : null}
                            </button>
                          ) : (
                            <span className="cf-zero">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={net(r) >= 0 ? "cf-good" : "cf-bad"}>{net(r) > 0 ? `+${int(net(r))}` : int(net(r))}</td>
                    <td>{r.first ? int(r.first) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cell ? (
            <div className="cf-list">
              <div className="cf-list-head">
                <b>{cell.title}</b>
                <span>{list?.ready ? `${int(list.total)} clinics${list.total > list.rows.length ? `, top ${list.rows.length} by revenue` : ""}` : "Loading…"}</span>
                <button type="button" onClick={() => setCell(null)}>Close</button>
              </div>
              {list?.ready ? (
                <table className="cf-table cf-clinics">
                  <thead>
                    <tr>
                      <th>Clinic</th>
                      <th>Rep</th>
                      <th>Moved</th>
                      <th>Revenue that month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map(c => (
                      <tr key={c.clinic}>
                        <td>
                          {c.name} <span className="cf-id">#{c.clinic}</span>
                        </td>
                        <td>{c.sales}</td>
                        <td>
                          {LABEL[c.before ?? ""] ?? c.before} → {LABEL[c.after ?? ""] ?? c.after}
                        </td>
                        <td className="mono">
                          {K(c.rev)} <span className="cf-id">{MONTHS[+c.revMonth.slice(5, 7) - 1]}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
          <p className="cf-note">
            Cohorts follow the same rules as the clinic card: lifecycle first (churned, reactivated, new), then the company's Top 20% list for that month (last 12
            months of revenue). Revenue is the clinic's revenue in the month before it moved down or churned (what was at stake), and in the month it moved up or came
            back. "Back within 2 mo" are clinics that crossed their churn line and ordered again soon after: mostly irregular orderers, not lost clinics. Earlier
            month-ends reuse some inputs of the latest rebuild (baseline and prior-year revenue). Data through {res.dataThrough}; {int(res.clinics)} clinics.
          </p>
        </div>
      ) : null}
    </div>
  );
}
