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

/**
 * The week plan's fill without double counting (2026-11-20). Greedy by marginal $ per hour: an action's marginal expected dollars count
 * only its clinics' share not already covered by actions chosen before it (each clinic once, at its largest share, as in
 * dedupedExpected), so two actions on the same clinics (a Gut Zoomer list and the lapsed Gut Zoomer list, idle and untouched clinics) are
 * not both counted in full. Pinned-in actions go first; pinned-out never; `defaultOut` actions (Growth: suggested) only when pinned in.
 * Rows not chosen get the marginal they would add to the final plan. The sum of `mexp` over the plan equals dedupedExpected(plan).total.
 */
export type FillIn = { id: string; ids?: string[]; exp: number; hrs: number; /** pillar weight on the score */ w?: number; pin?: "in" | "out"; defaultOut?: boolean };
export type FillOut<T> = T & { mexp: number; overlap: number; mscore: number; inPlan: boolean };

export function marginalFill<T extends FillIn>(rows: T[], budget: number): Array<FillOut<T>> {
  const best = new Map<string, number>();
  const share = (r: FillIn) => (r.ids?.length ? r.exp / new Set(r.ids).size : 0);
  const marginal = (r: FillIn) => {
    if (!r.ids?.length) return { m: Math.max(0, r.exp), overlap: 0 };
    const s = share(r);
    let m = 0, overlap = 0;
    for (const c of new Set(r.ids)) {
      const b = best.get(c);
      if (b !== undefined) overlap++;
      m += Math.max(0, s - (b ?? 0));
    }
    return { m: r.exp > 0 ? m : 0, overlap };
  };
  const take = (r: FillIn) => {
    const s = share(r);
    for (const c of new Set(r.ids ?? [])) if (s > (best.get(c) ?? -Infinity)) best.set(c, s);
  };
  const scoreOf = (r: FillIn, m: number) => (m / Math.max(r.hrs, 0.25)) * (r.w ?? 1);
  const out: Array<FillOut<T>> = [];
  const left = new Set(rows.map((_, i) => i));
  let used = 0;
  // 1. Pinned in, by their own score.
  const pinned = rows.map((r, i) => ({ r, i })).filter(x => x.r.pin === "in").sort((a, b) => scoreOf(b.r, b.r.exp) - scoreOf(a.r, a.r.exp));
  for (const { r, i } of pinned) {
    const { m, overlap } = marginal(r);
    out.push({ ...r, mexp: m, overlap, mscore: scoreOf(r, m), inPlan: true });
    take(r);
    used += r.hrs;
    left.delete(i);
  }
  // 2. Greedy on marginal $ per hour while hours remain.
  for (;;) {
    let pick = -1, pickScore = 0, pickM = { m: 0, overlap: 0 };
    for (const i of left) {
      const r = rows[i];
      if (r.pin === "out" || r.defaultOut || used + r.hrs > budget) continue;
      const mm = marginal(r);
      const sc = scoreOf(r, mm.m);
      if (mm.m > 0 && sc > pickScore) { pick = i; pickScore = sc; pickM = mm; }
    }
    if (pick < 0) break;
    const r = rows[pick];
    out.push({ ...r, mexp: pickM.m, overlap: pickM.overlap, mscore: pickScore, inPlan: true });
    take(r);
    used += r.hrs;
    left.delete(pick);
  }
  // 3. The rest: what each would add to the plan as it stands.
  const rest = [...left].map(i => {
    const r = rows[i];
    const { m, overlap } = marginal(r);
    return { ...r, mexp: m, overlap, mscore: scoreOf(r, m), inPlan: false };
  });
  rest.sort((a, b) => b.mscore - a.mscore);
  return [...out, ...rest];
}

/**
 * What one action does to the outcome (2026-11-20): for an action in the plan, the plan with it vs without it ("what it brings"); for one
 * out of the plan, the plan plus it vs the plan ("if you add it"). Dials and count cells as in dialImpact / cellImpact.
 */
export function actionImpact(plan: PlanRow[], row: PlanRow, pace: PaceLite | null, cells: CellIn[]) {
  const inPlan = plan.some(r => r.id === row.id);
  const base = inPlan ? plan.filter(r => r.id !== row.id) : plan;
  const withR = inPlan ? plan : [...plan, row];
  return {
    inPlan,
    dollars: dedupedExpected(withR).total - dedupedExpected(base).total,
    dialsBefore: pace ? dialImpact(base, pace) : [],
    dialsAfter: pace ? dialImpact(withR, pace) : [],
    cellsBefore: cellImpact(base, cells),
    cellsAfter: cellImpact(withR, cells),
  };
}

/** Queue filters (2026-11-20). High ROI = the top third of actions by marginal $ per hour. */
export type QueueFilter = { pillar?: string | null; highRoi?: boolean; source?: "scorecard" | "growth-committed" | "growth-suggested" | null; show?: "all" | "in" | "out"; behind?: boolean };
export type QueueRow = { p: string; mscore: number; inPlan: boolean; growthKind?: "committed" | "suggested" | null };

export function roiLine(rows: QueueRow[]): number {
  const s = rows.map(r => r.mscore).filter(x => x > 0).sort((a, b) => b - a);
  return s.length ? s[Math.max(0, Math.ceil(s.length / 3) - 1)] : Infinity;
}

export function filterQueue<T extends QueueRow>(rows: T[], f: QueueFilter, status: Record<string, string>): T[] {
  const line = f.highRoi ? roiLine(rows) : -Infinity;
  return rows.filter(
    r =>
      (!f.pillar || r.p === f.pillar) &&
      (!f.highRoi || (r.mscore > 0 && r.mscore >= line)) &&
      (!f.source ||
        (f.source === "scorecard" ? !r.growthKind : f.source === "growth-committed" ? r.growthKind === "committed" : r.growthKind === "suggested")) &&
      (!f.show || f.show === "all" || (f.show === "in" ? r.inPlan : !r.inPlan)) &&
      (!f.behind || status[r.p] === "behind" || status[r.p] === "watch"),
  );
}
