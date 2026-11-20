/**
 * Growth opportunities in a rep's week plan (2026-11-20). The Growth page sizes opportunities for the company or a team; every one that is
 * not Dropped reaches each rep's "My week plan" with the rep's own clinics. Committed ones (status Committed, Executing or Scaling) are
 * filled into the plan like any other action; the rest are "Suggested" and stay out until the rep pins them in:
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
  untouched: ["idle"],
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
  /** Committed, Executing or Scaling on the Growth page; otherwise Suggested. */
  committed: boolean;
};

/** Growth tag on an action the plan already has. */
export type GrowthTag = { name: string; committed: boolean };

const WEEK = 7 / 365;

/**
 * Tags for existing plan actions (action id -> opportunity name) and new actions for committed opportunities with no matching action.
 * `opps` are resolved at the rep's scope; `existing` is the set of action ids the plan already has this week.
 */
export function growthActions(opps: Opp[], existing: ReadonlySet<string>): { tags: Record<string, GrowthTag>; extra: GrowthAction[] } {
  const tags: Record<string, GrowthTag> = {};
  const extra: GrowthAction[] = [];
  for (const o of opps) {
    if (o.status === "Dropped" || o.n <= 0) continue;
    const committed = IN_PLANS.includes(o.status);
    const same = (PLAN_ACTIONS_OF[o.id] ?? []).filter(a => existing.has(a));
    if (same.length) {
      // A committed opportunity wins the tag over a suggested one on the same action.
      for (const a of same) if (!tags[a] || (committed && !tags[a].committed)) tags[a] = { name: o.name, committed };
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
      detail: `${o.clinicIds.length.toLocaleString("en-US")} of your clinics · ${committed ? "committed on the Growth page" : "suggested by the Growth page"}`,
      ids: o.clinicIds,
      up,
      pr,
      n: o.clinicIds.length,
      committed,
    });
  }
  return { tags, extra };
}
