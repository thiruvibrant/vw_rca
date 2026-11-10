# Baseline and goal: one definition for the RCA dashboard and the executive emails

**Status:** proposed, 2026-11-09. Needs sign-off from Shyam (dashboard) and sales leadership (target and split) before any code changes.
**Applies to:** the RCA dashboard (every view) and the executive daily, weekly and monthly emails (`Sales Ad hoc/_shared/exec_core`).

## Why
- The dashboard and the emails use different baselines and goals, so leadership sees two different numbers for the same week.
- The dashboard's push on reps is uneven, from −12% to +23% depending on the rep (example below).
- The $130M target doesn't change any dashboard goal today.

## The four terms

| Term | Question it answers | Looks |
|---|---|---|
| **Baseline** | What does a normal period look like right now? | Back, at recent results |
| **Goal** | Where do we need to be to hit the annual target? | Forward, at the target |
| **Heading** | Where will we end the period at the current pace? | From so far to the end of the period |
| **Benchmark ("good normal")** | What did our strong periods produce? | Back, at the best periods only |

The push on reps comes from the **goal**. The baseline stays honest so root-cause analysis shows real changes.

## 1. Goal

1. **Company daily goal.** The annual target (2026: **$130M**, set by leadership in Settings) is spread over the year's days in **last year's daily revenue pattern**.
   - Each day uses the same weekday 364 days earlier (a Monday is compared with a Monday).
   - Holidays are matched **by name**: Thanksgiving 2026 uses Thanksgiving 2025. If last year's comparison day was a holiday that this year's day isn't, it uses an average of normal same-weekday days around it.
   - The daily goals add up to exactly the target.
2. **New-business goal.** A slice of the target is set aside for clinics whose first order is this year. It's the Settings number, or last year's new-clinic revenue by default, phased by last year's monthly new-clinic pattern. The rest is the **existing-business goal**.
3. **Period goal.** The sum of the daily goals in the period (day, week, month, quarter, year). For an unfinished period, the **goal to date** is the sum through the same cut-off.
4. **Heading.** Revenue so far × full-period goal ÷ goal to date.
5. **Orders goal.** The baseline orders × (revenue goal ÷ revenue baseline), the same stretch as revenue.

## 2. Splitting the goal: reps, clinics, states and product families

1. **Shares come from the baseline (section 3).** A rep's share of the existing-business goal = the rep's book baseline ÷ the company baseline. The same rule applies to clinics within a rep, to states and to team leads.
2. **Everything adds up:** company = Σ team leads = Σ reps = Σ clinics = Σ states, for every period.
3. **Product families:** a rep's family goal (orders) = the rep's orders goal × that family's share of the rep's baseline orders.
   - Family = the order-level `product_family`. An order listing two families counts once in each.
   - Revenue is split equally between the families an order lists.
4. **Same stretch for everyone:** every rep's goal sits the same percentage above their own recent pace. Territory size and product mix come through each rep's own book. There is no separate territory factor, because in testing it made accuracy worse (21% error vs 7%).
5. **Share-drop cap:** a rep's share can fall by at most **5% per quarter** (proposed), so one bad quarter doesn't shrink the next goal sharply. The company total always equals the target.
6. **New-business goal** is split over reps by baseline share, as today.

## 3. Baseline

1. **Window:** the **13 weeks (91 days) before the start of the current quarter**. It moves forward automatically each quarter. Example: Q4 2026 uses Jul 2 – Sep 30 2026.
2. **Calculation:** mean revenue (and orders) per weekday over the window, per clinic, then summed over the days of the period being viewed. Means add up across clinics, reps and states; medians and percentiles don't.
3. **Holidays:** weekday holidays and the catch-up day after a closure are left out of the window's weekday means. The current period's holidays use their usual share of a normal day (the `holidays.csv` factors).
4. **New clinics** (first order this year) have no baseline. They are measured against the new-business goal.
5. **Unfinished periods** are compared at the same cut-off as the current one.

## 4. Benchmark ("good normal")
- The emails' measure: the median of the best N comparable periods in the last 12 months (26 same weekdays, 13 weeks or 4 months).
- It stays in the emails and can be shown on the dashboard as a **labelled reference line**.
- It is **never** used as a rep's expectation or goal. It sits about 12% above actual in a steady business (13 weeks tested, Aug–Oct 2026).

## 5. Worked example: November 2026 (company revenue, BigQuery)
These are before the holiday adjustment for Thanksgiving.

| | Dashboard today | Emails today | This definition |
|---|---|---|---|
| Baseline | $10.21M (Jan 30 – Apr 30 pace, peak season) | $10.47M (median of the best 4 months: Apr, Mar, Jun, Jul 2026) | **$9.30M** (Aug 3 – Nov 1 pace) |
| Goal | $10.21M + new-business slice (the $130M has no effect) | $10.10M ($130M × Nov 2025's 7.77% share of 2025) | **$10.10M** |
| Stretch over recent pace | +9.7% on average, **−12% to +23% by rep** | +8.6% | **+8.6% for every rep** |

Reference: Nov 2025 actual was $8.40M. Nov 1–8 2026 was $2.13M.

Reps, 30-day pace:

| Rep (sales_id) | Recent pace | Bar today (best window) | Stretch today | Goal under this definition |
|---|---|---|---|---|
| 816 | $294.7K | $362.9K | +23% | $320.0K |
| 857 | $464.3K | $557.8K | +20% | $504.3K |
| 884 | $1,072.2K | $1,105.8K | +3% | $1,164.4K |
| 1114 | $198.8K | $174.2K | −12% | $215.9K |

**Accuracy** (Aug–Oct 2026, how far each baseline was from what actually happened):
- Company weekly: trailing 13 weeks **3.5%**, emails' benchmark 12.3%.
- By rep: trailing 13 weeks **7.2%**, dashboard today 11.7%.

## 6. What changes vs today

| | Dashboard today | Change |
|---|---|---|
| Baseline window | Best 91 days, Jan 2025 → Apr 30 2026, fixed | Trailing 13 weeks before the quarter, moves each quarter |
| Holidays | Ignored | Left out of the baseline; goal matched by name |
| Goal spread | Baseline weekday weights (no seasonality), floored at the baseline | Last year's daily pattern; exactly the target |
| Business feed, leaderboard, state chart, family lists, projection | Each uses a slightly different rule | All follow sections 1–3 |
| Small family tiles | Coloured red/green on 2 vs 6 orders | Grey "—" below 5 expected orders |
| Emails | Benchmark used as the baseline | Benchmark kept and labelled; goal unchanged |

## 7. Governance
- **Owners:** the target and new-business goal belong to sales leadership. The definitions in this file belong to the dashboard owner (Shyam). Changes go through a PR that updates this file.
- **Change log:** every Settings change (target, new-business goal, baseline option) records who, when, the old value and the new value.
- **Automatic checks on every rebuild.** If any fails, the dashboard keeps the previous day's data and alerts the owner, as the emails' `validate.py` does:
  - company = Σ reps = Σ states = Σ clinics, within $1
  - the year's daily goals sum to the target
  - revenue so far matches BigQuery `SUM(total)`
- **Yearly:** add the next year's rows to `holidays.csv` each December; leadership confirms the next year's target before Jan 1.
- **One source (later):** compute the daily goal and baseline tables once in BigQuery, read by both the emails and the dashboard (see `PROPOSAL_CUBE_FIRST_REFACTOR.md`).

## 8. Decisions needed before building
1. The 2026 target to use: $130M, or a stretch number. Each extra $5M adds about 4% to every rep's goal.
2. The share-drop cap: 5% per quarter, or another number.
3. The baseline window: fixed per quarter (proposed) or rolling daily.
4. Whether the "good normal" benchmark line appears on the dashboard.
