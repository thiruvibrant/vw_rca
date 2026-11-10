/** Overview momentum tiles: fetches the engine's momentum read and draws it (MomentumView.tsx). Hidden until there is one. */
import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import { MomentumView, type Summary } from "./MomentumView";

export function MomentumTile({ teamLead }: { teamLead?: string }) {
  const res = useRcaQuery(api.momentum.summary, { password: pw() }) as Summary | { ready: false } | undefined;
  if (!res || !res.ready || !res.revenue || !res.orders) return null;
  return <MomentumView m={res} teamLead={teamLead} />;
}
