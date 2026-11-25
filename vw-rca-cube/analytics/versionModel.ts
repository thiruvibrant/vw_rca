/**
 * Test versions, relaunches and variants (2026-11-25). Pure functions, shared by the snapshot step (productVersions.ts) and the offline
 * checks (scripts/product-versions.test.ts).
 *
 * The product family is built from the cleaned test name (`test_name_v2`), which strips version numbers and variants: "Nutrient Baseline
 * 2.0" and "Foundation Baseline Male" count in Nutrient Baseline and Foundation Baseline. Family totals are right, but a relaunch is
 * invisible. The raw `test_name` keeps them, so each raw name is a version of its cleaned name (its base), and its start is read from the
 * orders:
 *  - start = the official date when there is one (launchModel.ts VERSION_DATES), else the first day whose 7 days hold 3+ orders
 *    (launchDateOf: one stray early order is not a start).
 *  - kind: `new` = nothing else in the base sold in the 4 weeks before; `relaunch` = it replaced the earlier version (the others fell
 *    below a quarter of what they sold in the 4 weeks before); `variant` = the others kept selling (e.g. a Male version next to the original).
 *  - read: the base's attach rate (orders per 100 company orders, so the season cancels) since the start, against its own range over the
 *    13 scored weeks before. Holiday weeks are not scored. A base that only shifted between versions reads "flat".
 */
import { addDays, diffDays } from "./dateUtils";
import { holidayWeek, launchDateOf, launchWeeks, MODEL, ownBand, scoredWeeks, VERSION_DATES, type Day } from "./launchModel";

export type Version = { name: string; base: string; days: Day[] };
export type VersionKind = "new" | "relaunch" | "variant";

export const VERSIONS = {
  /** a start counts as an event for this many days */
  eventDays: 180,
  /** and needs this many orders since the start (one-off test codes are not launches) */
  minOrders: 10,
  /** the earlier versions' window before and after a start */
  compareDays: 28,
  /** after / before below this = the new version replaced the old one */
  replaced: 0.25,
  /** versions starting within this many days of each other are one event (they are not each other's predecessor) */
  sameStart: 7,
  /** weeks before the start that set the base's own range */
  beforeWeeks: 13,
};

/** What a raw name adds to its base: "2.0", "Male", "New York". The base's own name is "original". */
export function versionLabel(name: string, base: string): string {
  const a = name.trim().split(/\s+/), b = base.trim().split(/\s+/);
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  const rest = a.slice(i).join(" ").replace(/^\(|\)$/g, "");
  return rest || "original";
}

const sumIn = (days: readonly Day[], from: string, to: string) => days.reduce((t, x) => (x.d >= from && x.d <= to ? t + x.o : t), 0);

/** Start date of a version: the official date, else the first day with 3+ orders in its 7 days. */
export function startOf(v: Version): { start: string | null; official: boolean } {
  const off = VERSION_DATES[v.name.trim()];
  return off ? { start: off, official: true } : { start: launchDateOf(v.days), official: false };
}

/** New, relaunch or variant: what the base's other versions did around this version's start. */
export function kindOf(start: string, others: ReadonlyArray<Version & { start: string | null }>, asOf: string): VersionKind {
  const prior = others.filter(o => !o.start || Math.abs(diffDays(o.start, start)) > VERSIONS.sameStart);
  const before = prior.reduce((t, o) => t + sumIn(o.days, addDays(start, -VERSIONS.compareDays), addDays(start, -1)), 0);
  if (before < MODEL.startOrders) return "new";
  const end = addDays(start, VERSIONS.compareDays - 1) < asOf ? addDays(start, VERSIONS.compareDays - 1) : asOf;
  const span = diffDays(start, end) + 1;
  const after = (prior.reduce((t, o) => t + sumIn(o.days, start, end), 0) * VERSIONS.compareDays) / Math.max(1, span);
  return after / before < VERSIONS.replaced ? "relaunch" : "variant";
}

/** Daily orders of every version in a base, added up. */
export function baseDays(versions: readonly Version[]): Day[] {
  const m = new Map<string, Day>();
  for (const v of versions) for (const x of v.days) {
    const a = m.get(x.d) ?? { d: x.d, o: 0, r: 0 };
    a.o += x.o;
    a.r += x.r;
    m.set(x.d, a);
  }
  return [...m.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

export type Read = "too-early" | "grew" | "flat" | "fell" | "no-history";

/**
 * The base's attach rate since `start` against its own range over the 13 scored weeks before. Needs 3 scored weeks after
 * (MODEL.earlyScored, as for launches); then "grew" / "fell" when the last 2 scored weeks are both above / below the range.
 */
export function readOf(days: readonly Day[], company: ReadonlyMap<string, number>, start: string, asOf: string, baseStart?: string | null) {
  // The weeks before never reach back past the base's own first start (a family launched 6 weeks ago has 6 weeks of history, not 13 with zeros).
  let from = addDays(start, -7 * VERSIONS.beforeWeeks);
  while (baseStart && from < baseStart) from = addDays(from, 7);
  const before = from < start ? launchWeeks(days, company, from, addDays(start, -1)) : [];
  const band = ownBand(before, VERSIONS.beforeWeeks);
  const own = band && band.median > 0 ? band : null;
  const after = launchWeeks(days, company, start, asOf);
  const scored = scoredWeeks(after);
  const since = scored.length ? scored.reduce((t, w) => t + w.attach, 0) / scored.length : null;
  let read: Read;
  if (!own) read = "no-history";
  else if (scored.length < MODEL.earlyScored) read = "too-early";
  else {
    const last = scored.slice(-MODEL.runWeeks);
    read = last.every(w => w.attach > own.p75) ? "grew" : last.every(w => w.attach < own.p25) ? "fell" : "flat";
  }
  return {
    before: own,
    since,
    scored: scored.length,
    lift: own && since !== null && own.median > 0 ? since / own.median - 1 : null,
    read,
    weeks: after.map(w => ({ n: w.n, start: w.start, complete: w.complete, holiday: w.holiday, orders: w.orders, attach: w.attach })),
  };
}

/** Monday of the week holding `d`. */
export const mondayOf = (d: string) => {
  const dow = new Date(d + "T00:00:00Z").getUTCDay();
  return addDays(d, -((dow + 6) % 7));
};

export type VersionEvent = {
  base: string;
  name: string;
  label: string;
  kind: VersionKind;
  start: string;
  official: boolean;
  /** orders dated before an official start (a system issue or a pilot), left out */
  preOrders: number;
  orders: number;
  /** this version's share of the base's orders since its start */
  share: number;
  /** the earlier versions it sits next to or replaced */
  replaces: string[];
  read: ReturnType<typeof readOf>;
};

/**
 * Every base with a recent start: its events and its weekly orders by version (calendar weeks from Monday, the last `weeks`), for a
 * stacked chart. Versions are grouped by base; a base with one version and no recent start is left out.
 */
export function versionEvents(all: readonly Version[], company: ReadonlyMap<string, number>, asOf: string, weeks = 26) {
  const byBase = new Map<string, Version[]>();
  for (const v of all) byBase.set(v.base, [...(byBase.get(v.base) ?? []), v]);
  const since = addDays(asOf, -VERSIONS.eventDays);
  const out: Array<{ base: string; events: VersionEvent[]; weekly: Array<{ week: string; partial: boolean; holiday: boolean; byVersion: Record<string, number> }>; versions: string[] }> = [];
  for (const [base, vs] of byBase) {
    const withStart = vs.map(v => ({ ...v, ...startOf(v) }));
    const baseStart = withStart.map(v => v.start).filter((d): d is string => !!d).sort()[0] ?? null;
    const events: VersionEvent[] = [];
    for (const v of withStart) {
      if (!v.start || v.start < since || v.start > asOf) continue;
      const orders = sumIn(v.days, v.start, asOf);
      if (orders < VERSIONS.minOrders) continue;
      const others = withStart.filter(o => o.name !== v.name);
      const kind = kindOf(v.start, others, asOf);
      const total = sumIn(baseDays(vs), v.start, asOf);
      events.push({
        base,
        name: v.name.trim(),
        label: versionLabel(v.name, base),
        kind,
        start: v.start,
        official: v.official,
        preOrders: v.official ? sumIn(v.days, "0000-01-01", addDays(v.start, -1)) : 0,
        orders,
        share: total > 0 ? orders / total : 0,
        replaces: kind === "new" ? [] : others.filter(o => sumIn(o.days, addDays(v.start!, -VERSIONS.compareDays), addDays(v.start!, -1)) >= MODEL.startOrders).map(o => o.name.trim()),
        read: readOf(baseDays(vs), company, v.start, asOf, baseStart),
      });
    }
    if (!events.length) continue;
    // Pre-launch strays are not plotted: a version counts from its start.
    const days = withStart.map(v => ({ name: v.name.trim(), days: v.days.filter(x => !v.start || x.d >= v.start) }));
    const first = mondayOf(addDays(asOf, -7 * (weeks - 1)));
    const weekly: Array<{ week: string; partial: boolean; holiday: boolean; byVersion: Record<string, number> }> = [];
    for (let w = first; w <= asOf; w = addDays(w, 7)) {
      const byVersion: Record<string, number> = {};
      for (const v of days) {
        const n = sumIn(v.days, w, addDays(w, 6));
        if (n) byVersion[v.name] = n;
      }
      weekly.push({ week: w, partial: addDays(w, 6) > asOf, holiday: holidayWeek(w), byVersion });
    }
    const versions = days.filter(v => weekly.some(w => w.byVersion[v.name])).map(v => v.name);
    events.sort((a, b) => (a.start < b.start ? 1 : -1));
    out.push({ base, events, weekly, versions });
  }
  return out.sort((a, b) => (a.events[0].start < b.events[0].start ? 1 : -1));
}
