/**
 * "If you follow this plan": how the scorecard's dials and a few cells would move if every action in the week plan works as expected
 * (2026-11-20). Pure, for the tests (scripts/plan-impact.test.ts). These are estimates, not forecasts.
 *
 *  Dollars  Each action's expected dollars are spread over its clinics. A clinic in several actions counts once, at its largest share, so
 *           overlapping actions (overdue calls and at-risk check-ins on the same clinic) are not added twice.
 *  Dials    New Business actions land in New revenue; every other pillar's land in Existing business (they are clinics that already order);
 *           Combined is both. Each dial: heading now -> heading + the plan's dollars, against its goal for the week.
 *  Cells    A count cell (at-risk customers, churned clinics, cross-sell candidates, whitespace) drops by the clinics in the plan times the
 *           chance each one works (the best chance when a clinic is in several actions).
 */
export type PlanRow = { id: string; p: string; ids?: string[]; exp: number; pr: number };

/** Expected dollars per pillar after removing double counting across actions, and the total. */
export function dedupedExpected(rows: PlanRow[]): { byPillar: Record<string, number>; total: number } {
  const best = new Map<string, { v: number; p: string }>();
  const byPillar: Record<string, number> = {};
  for (const r of rows) {
    if (!(r.exp > 0)) continue;
    const ids = r.ids?.length ? [...new Set(r.ids)] : null;
    if (!ids) {
      byPillar[r.p] = (byPillar[r.p] ?? 0) + r.exp;
      continue;
    }
    const share = r.exp / ids.length;
    for (const c of ids) {
      const cur = best.get(c);
      if (!cur || share > cur.v) best.set(c, { v: share, p: r.p });
    }
  }
  for (const { v, p } of best.values()) byPillar[p] = (byPillar[p] ?? 0) + v;
  const total = Object.values(byPillar).reduce((t, x) => t + x, 0);
  return { byPillar, total };
}

export type PaceLite = { heading: number; plan: number; newHeading?: number; newPlan?: number; existingHeading?: number; existingPlan?: number };
export type Dial = { key: "existing" | "new" | "combined"; label: string; now: number; withPlan: number; goal: number };

export const NEW_PILLAR = "New Business";

export function dialImpact(rows: PlanRow[], pace: PaceLite): Dial[] {
  const { byPillar, total } = dedupedExpected(rows);
  const neu = byPillar[NEW_PILLAR] ?? 0;
  const ex = total - neu;
  const out: Dial[] = [];
  if (pace.existingPlan != null && pace.existingHeading != null)
    out.push({ key: "existing", label: "Existing business", now: pace.existingHeading, withPlan: pace.existingHeading + ex, goal: pace.existingPlan });
  if (pace.newPlan != null && pace.newHeading != null)
    out.push({ key: "new", label: "New revenue", now: pace.newHeading, withPlan: pace.newHeading + neu, goal: pace.newPlan });
  out.push({ key: "combined", label: "Combined revenue", now: pace.heading, withPlan: pace.heading + total, goal: pace.plan });
  return out;
}

export type CellIn = { label: string; ids: string[]; now: number; /** For a rate: the count's base (rate = count / base). */ base?: number; lowerBetter?: boolean };
export type CellOut = { label: string; now: number; after: number; moved: number; rate: boolean };

/** Each cell: how many of its clinics the plan should move (sum of the best chance per clinic), and the value after. */
export function cellImpact(rows: PlanRow[], cells: CellIn[]): CellOut[] {
  const chance = new Map<string, number>();
  for (const r of rows) for (const c of r.ids ?? []) chance.set(c, Math.max(chance.get(c) ?? 0, r.pr));
  return cells.map(cell => {
    let moved = 0;
    for (const c of new Set(cell.ids)) moved += chance.get(c) ?? 0;
    const rate = cell.base !== undefined;
    const countNow = rate ? cell.now * (cell.base ?? 0) : cell.now;
    const countAfter = Math.max(0, countNow - moved);
    const after = rate ? (cell.base ? countAfter / cell.base : 0) : countAfter;
    return { label: cell.label, now: cell.now, after, moved, rate };
  });
}

/** The first actions to do: the plan's top three by score, with why each is first. */
export function doFirst<T extends { id: string; p: string; score: number; exp: number; hrs: number; inPlan?: boolean }>(
  rows: T[],
  status: Record<string, string>,
): Array<T & { why: string }> {
  return rows
    .filter(r => r.inPlan && r.exp > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(r => ({
      ...r,
      why: status[r.p] === "behind" ? `${r.p} is behind` : status[r.p] === "watch" ? `${r.p} is on watch` : "best $ per hour",
    }));
}
