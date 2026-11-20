/**
 * Growth opportunities in a rep's week plan (2026-11-20). The Growth page sizes opportunities for the company or a team; once the team
 * commits one (status Committed, Executing or Scaling), it reaches each rep's "My week plan" with the rep's own clinics:
 *  - when the plan already has the same work (at-risk calls, win-backs, second orders, FZ cross-sell, whitespace), that action is tagged
 *    with the opportunity, so the same clinics are not planned twice;
 *  - otherwise it becomes an action of its own: the opportunity's clinics in the rep's book, a week of its value, and the rate change the
 *    team committed to as the likelihood.
 * Pure, for the tests (scripts/plan-impact.test.ts).
 */
import type { Opp, Pillar } from "./growthOpps";

/** Growth opportunity id -> the week-plan actions that already do that work. */
export const PLAN_ACTIONS_OF: Record<string, string[]> = {
  "at-risk": ["atRisk", "callFirst"],
  reactivate: ["churned"],
  "second-order": ["secondOrder", "nurture"],
  "fz-targets": ["crosssell"],
  whitespace: ["whitespace"],
};

/** Statuses that put an opportunity into reps' plans (convex/growth.ts `committed`). */
export const IN_PLANS = ["Committed", "Executing", "Scaling"];

export type GrowthAction = {
  id: string;
  oppId: string;
  p: Pillar;
  label: string;
  detail: string;
  ids: string[];
  /** Weekly dollars at stake: clinics x value a year x 7/365. */
  up: number;
  /** The committed rate change (target - current), capped at 90%. */
  pr: number;
  n: number;
};

const WEEK = 7 / 365;

/**
 * Tags for existing plan actions (action id -> opportunity name) and new actions for committed opportunities with no matching action.
 * `opps` are resolved at the rep's scope; `existing` is the set of action ids the plan already has this week.
 */
export function growthActions(opps: Opp[], existing: ReadonlySet<string>): { tags: Record<string, string>; extra: GrowthAction[] } {
  const tags: Record<string, string> = {};
  const extra: GrowthAction[] = [];
  for (const o of opps) {
    if (!IN_PLANS.includes(o.status) || o.n <= 0) continue;
    const same = (PLAN_ACTIONS_OF[o.id] ?? []).filter(a => existing.has(a));
    if (same.length) {
      for (const a of same) tags[a] = o.name;
      continue;
    }
    const pr = Math.min(0.9, Math.max(0, (o.tgtEff - o.cur) / 100));
    const up = o.n * o.value * WEEK;
    if (!(up > 0) || !(pr > 0) || !o.clinicIds.length) continue;
    extra.push({
      id: `growth:${o.id}`,
      oppId: o.id,
      p: o.pillar,
      label: o.name,
      detail: `${o.clinicIds.length.toLocaleString("en-US")} of your clinics · committed on the Growth page`,
      ids: o.clinicIds,
      up,
      pr,
      n: o.clinicIds.length,
    });
  }
  return { tags, extra };
}
