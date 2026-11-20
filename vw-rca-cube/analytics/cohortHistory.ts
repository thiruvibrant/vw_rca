/**
 * Cohort history for the "Cohort movement · last 12 months" table (2026-11-20). One row per clinic with a label at any
 * month-end in the last 12 months: its label at each month-end (codes from clinicLabels.ts) and its revenue each month.
 *
 * clinicMeta only holds clinics in the baseline or the analysis window (or new this year), so a clinic that went quiet
 * before the baseline window would be missing from the early months. Those clinics are labelled here with the same rules,
 * from their order dates (no baseline or window revenue, by definition). Pure, for the tests (scripts/clinic-labels.test.ts).
 */
import { labelsFor, type TierList } from "./clinicLabels";

export type CohortHistoryRow = {
  clinic: string;
  name: string;
  sales: string;
  teamLead: string;
  /** label date -> code */
  labelAt: Record<string, string>;
  /** "YYYY-MM" -> revenue (complete months, plus the current month to date); months with none are left out */
  rev: Record<string, number>;
};

export function cohortHistoryRows(inp: {
  labelDays: string[];
  lists: Map<string, TierList>;
  /** "YYYY-MM" -> clinic -> revenue, the months the Top 20% lists were ranked on */
  monthRev: Map<string, Map<string, number>>;
  /** the current (partial) month's revenue by clinic */
  current?: { month: string; rev: Map<string, number> };
  /** labels already worked out for the clinics the rebuild covers (clinicMeta) */
  labelAtOf: Map<string, Record<string, string>>;
  firstOrderOf: Map<string, string>;
  orderDatesOf: Map<string, string[]>;
  priorRevOf: (clinic: string) => number;
  identityOf: (clinic: string) => { name: string; sales: string; teamLead: string } | undefined;
}): CohortHistoryRow[] {
  const first = inp.labelDays[0] ?? "";
  const months = [...inp.monthRev.keys()].filter(m => m >= first.slice(0, 7)).sort();
  const ids = new Set(inp.labelAtOf.keys());
  for (const m of months) for (const [c, r] of inp.monthRev.get(m) ?? []) if (r) ids.add(c);
  const out: CohortHistoryRow[] = [];
  for (const clinic of ids) {
    let labelAt = inp.labelAtOf.get(clinic);
    if (!labelAt) {
      labelAt = labelsFor(
        {
          clinic,
          firstOrder: inp.firstOrderOf.get(clinic) ?? "",
          orderDates: inp.orderDatesOf.get(clinic) ?? [],
          hasBaselineRevenue: false,
          hasWindowRevenue: false,
          priorRevenue: inp.priorRevOf(clinic),
        },
        inp.labelDays,
        inp.lists,
      );
    }
    if (!Object.keys(labelAt).length) continue;
    const rev: Record<string, number> = {};
    for (const m of months) {
      const r = inp.monthRev.get(m)?.get(clinic) ?? 0;
      if (r) rev[m] = Math.round(r * 100) / 100;
    }
    const cur = inp.current?.rev.get(clinic) ?? 0;
    if (inp.current && cur) rev[inp.current.month] = Math.round(cur * 100) / 100;
    const idt = inp.identityOf(clinic);
    out.push({ clinic, name: idt?.name ?? `Clinic ${clinic}`, sales: idt?.sales ?? "—", teamLead: idt?.teamLead ?? "—", labelAt, rev });
  }
  return out;
}
