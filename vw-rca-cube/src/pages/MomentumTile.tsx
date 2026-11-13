/**
 * Overview momentum tiles: fetches the engine's momentum read and draws it (MomentumView.tsx). Hidden until there is one.
 * Collapsed by default to one short bar with a blinking status dot; clicking it opens the tiles.
 */
import { useState } from "react";
import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import { look, MomentumView, type Summary } from "./MomentumView";

const RANK = { red: 2, amber: 1, green: 0 } as const;

export function MomentumTile({ teamLead }: { teamLead?: string }) {
  const [open, setOpen] = useState(false);
  const res = useRcaQuery(api.momentum.summary, { password: pw() }) as Summary | { ready: false } | undefined;
  if (!res || !res.ready || !res.revenue || !res.orders) return null;
  const reads = [
    { name: "Revenue", r: res.revenue },
    { name: "Orders", r: res.orders },
  ];
  const worst = reads.reduce((a, b) => (RANK[b.r.light] > RANK[a.r.light] ? b : a)).r;
  return (
    <div className="ev-mo-wrap">
      <button
        type="button"
        className={`ev-mo-toggle${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls="ev-momentum"
        onClick={() => setOpen(o => !o)}
        title={open ? "Hide the trend check" : "Show how revenue and orders compare with normal for this time of year"}
      >
        <span className="ev-mo-dot" style={{ background: look(worst.light, worst.side).color }} aria-hidden />
        <span className="ev-mo-toggle-t">How are we trending?</span>
        {reads.map(({ name, r }) => (
          <span key={name} className="ev-mo-toggle-s">
            {name}: <b style={{ color: look(r.light, r.side).color }}>{look(r.light, r.side).word}</b>
          </span>
        ))}
        <span className="ev-mo-toggle-c" aria-hidden>{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open ? (
        <div id="ev-momentum">
          <MomentumView m={res} teamLead={teamLead} />
        </div>
      ) : null}
    </div>
  );
}
