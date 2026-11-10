# Baseline and goal: one definition for the RCA dashboard and the executive emails

**Status:** proposed, 2026-11-09 (revised). Needs sign-off from Shyam (dashboard) and sales leadership (target and split) before any code changes.
**Applies to:** the RCA dashboard (every view) and the executive daily, weekly and monthly emails (`Sales Ad hoc/_shared/exec_core`). Both use exactly these rules, so a number for the same scope and period is the same in both.

## Why
- The dashboard and the emails use different baselines and goals, so leadership sees two different numbers for the same week.
- The $130M target doesn't change any dashboard goal today: the goal is held at the baseline.
- Holidays are ignored by the dashboard and handled differently in the emails.

## The three terms

| Term | Question it answers | Looks |
|---|---|---|
| **Baseline** | What does a strong, normal period look like for us? | Back, at our best 13 weeks |
| **Goal** | Where do we need to be to hit the annual target? | Forward, at the target |
| **Heading** | Where will we end the period at the current pace? | From so far to the end of the period |

There is no separate benchmark. The emails' "median of the best N periods" is replaced by the baseline below.

## 1. Baseline

1. **Window:** the **best 91 consecutive days** (13 full weeks, so every weekday appears 13 times) by company revenue within the **12 months before the start of the current quarter**.
   - It is chosen again at the start of each quarter and stays fixed for the quarter, so numbers don't shift from day to day.
   - Today it is **Feb 20 – May 21 2026** ($31.61M), which is the best stretch for both the Q4 2026 and the "last 12 months" lookback.
2. **Holidays:** any day in `holidays.csv` that falls Monday–Friday is left out of the window before averaging, so a holiday doesn't drag the baseline down.
   - There is no catch-up rule. The first business day after a holiday ran at 0.97–1.07× a normal day across 2025–26.
   - The only low "day after" days are Dec 26 (0.27×) and Jan 2 (0.69–0.83×). They are holiday-season days, so they are listed in `holidays.csv` as holidays of their own.
3. **Calculation: the mean per weekday.** For each weekday, the average revenue (and orders) over that weekday's days in the window. Then add up those averages over the days of the period being viewed.
   - The mean is used, not the median. In this window they differ by at most 3%, at both company and rep level.
   - Means add up: company = Σ reps = Σ clinics = Σ states. Medians don't.
   - At clinic level the median doesn't work: most clinics don't order on most days, so their median is $0.
4. **Outlier guard:** at the company level, any single day above **2× that weekday's median** in the window is capped at 2× before averaging. One unusual bulk day can't lift the baseline. In this window no day exceeds 1.3× its weekday's median, so the cap changes nothing today.
5. **Clinics, reps, states and team leads:** each one's mean per weekday over the same window, scaled so they add up exactly to the company baseline (as the emails do today).
6. **New clinics** (first order this year) have no baseline. They are measured against the new-business goal.
7. **Unfinished periods** are compared at the same cut-off: the same weekdays passed, and the same hour on the last day.

## 2. Goal

1. **Company daily goal.** The annual target (2026: **$130M**, set by leadership in Settings) is spread over the year's days in **last year's daily pattern**. The daily goals add up to exactly the target.
2. **How each day's weight is set.** Each day = last year's **normal level** for that weekday at that time of year × this year's **calendar effect** for that day.
   - **Normal level:** the median of last year's same weekday in the four nearest weeks (2 before, 2 after the day 364 days earlier), leaving out holidays and catch-up days. A median of 4 nearby normal days is steady even when one neighbour was unusual.
   - **Calendar effect:** 1.0 on a normal day. On a weekday holiday, the holiday's measured factor from `holidays.csv` (for example Thanksgiving 0.07, the day after 0.27, Christmas 0.03).
   - **Why this is better than copying last year's day:** when a holiday moves to a different weekday (Christmas 2025 on a Thursday, 2026 on a Friday), the goal uses a normal Friday × the Christmas factor. It doesn't copy a Thursday holiday into a Friday. The day that was the holiday last year gets a normal-day goal, not last year's holiday dip.
3. **New-business goal.** A slice of the target for clinics whose first order is this year: the Settings number, or last year's new-clinic revenue by default.
   - It is phased by last year's monthly new-clinic pattern, then spread evenly over each month's calendar days.
   - The rest of the target is the **existing-business goal**, spread by the day weights above.
   - Company daily goal = existing-business goal + new-business goal for that day. Over the year it adds up to exactly the target.
4. **Period goal.** The sum of the daily goals in the period (day, week, month, quarter, year). For an unfinished period, the **goal to date** is the sum through the same cut-off.
5. **Heading.** Revenue so far × full-period goal ÷ goal to date.
6. **Orders goal.** The baseline orders × (revenue goal ÷ revenue baseline), the same stretch as revenue.

## 3. Splitting the goal: reps, clinics, states and product families

1. **Shares come from the baseline (section 1).** A rep's share of the existing-business goal = the rep's baseline ÷ the company baseline. The same rule applies to clinics within a rep, to states and to team leads.
2. **Everything adds up:** company = Σ team leads = Σ reps = Σ clinics = Σ states, for every period.
3. **Product families:** a rep's family goal (orders) = the rep's orders goal × that family's share of the rep's baseline orders.
   - Family = the order-level `product_family`. An order listing two families counts once in each.
   - Revenue is split equally between the families an order lists.
4. **New-business goal** is split over reps by baseline share, as today.

## 4. Worked example: November 2026 (company revenue, BigQuery)
These are before the holiday and outlier rules (sections 1.2, 1.4 and 2.2).

| | Dashboard today | Emails today | This definition |
|---|---|---|---|
| Baseline | $10.21M (Jan 30 – Apr 30 pace) | $10.47M (median of the best 4 months) | **$10.25M** (Feb 20 – May 21 pace) |
| Goal | $10.21M + new-business slice; the $130M has no effect | $10.10M ($130M × Nov 2025's 7.77% share of 2025) | **$10.10M**, before the new-business slice |

Reference: Nov 2025 actual was $8.40M; Nov 1–8 2026 was $2.13M; the last 13 weeks ran at $9.30M a month.

Rep November goals under this definition (the whole $10.10M split by best-window share):

| Rep (sales_id) | Recent 30-day pace (Aug 3 – Nov 1) | November goal | Above recent pace |
|---|---|---|---|
| 816 | $294.7K | $360.7K | +22% |
| 857 | $464.3K | $550.2K | +19% |
| 884 | $1,072.2K | $1,090.4K | +2% |
| 1114 | $198.8K | $177.2K | −11% |

Because shares come from the best window, a rep whose book has shrunk since Feb–May gets a bigger stretch, and one whose book has grown gets a goal below their current pace. See decision 2 below.

## 5. What changes vs today

| | Dashboard today | Emails today | Both, after this |
|---|---|---|---|
| Baseline window | Best 91 days, Jan 2025 → day before May 1 2026 | Best 26 days / 13 weeks / 4 months, last 12 months | Best 91 consecutive days, 12 months before the quarter |
| Baseline statistic | Mean per weekday | Median of the best N | Mean per weekday, outliers capped |
| Holidays in the baseline | Included | Excluded | Excluded |
| Goal spread | Baseline weekday weights; held at the baseline | Last year's daily pattern; holidays by name | Last year's normal level × this year's calendar effect; exactly the target |
| Business feed, leaderboard, state chart, family lists, projection | Each uses a slightly different rule | — | All follow sections 1–3 |
| Small family tiles | Coloured red/green on 2 vs 6 orders | — | Grey "—" below 5 expected orders |

## 6. Governance
- **Owners:** the target and new-business goal belong to sales leadership. These definitions belong to the dashboard owner (Shyam). Changes go through a PR that updates this file.
- **One holiday list:** `holidays.csv` (date, name, class, factor) is shared by the emails and the dashboard. Add the next year's rows each December, and re-measure the factors each January from the year just ended.
- **Change log:** every Settings change (target, new-business goal) records who, when, the old value and the new value.
- **Automatic checks on every rebuild and every email.** If any fails, the dashboard keeps the previous day's data and the email is held, as `validate.py` does today:
  - company = Σ reps = Σ states = Σ clinics, within $1
  - the year's daily goals sum to the target
  - revenue so far matches BigQuery `SUM(total)`
  - the dashboard and the email give the same baseline and goal for the same period
- **One source (later):** compute the daily goal and baseline tables once in BigQuery, read by both (see `PROPOSAL_CUBE_FIRST_REFACTOR.md`).

## Appendix A: exact rules (both implementations follow this text)
- **A1. Holidays.** `holidays.csv` (date, name, class, factor), kept in `vw-rca-cube/analytics/holidays.csv`; the emails read the same file. A *weekday holiday* is a listed date that falls Monday–Friday, of any class.
- **A2. Reference date and lookback.**
  - Reference date: the dashboard's data-through date, or the email period's last day.
  - Q = the calendar quarter containing the reference date.
  - Lookback L = from the first day of Q minus 12 months, through the day before Q starts.
- **A3. Window.** The 91-day run [s, s+90] inside L with the highest company revenue (`SUM(total)`, all orders). On a tie, the latest s.
- **A4. Day weights.** For each window day d:
  - w(d) = 0 if d is a weekday holiday.
  - Otherwise, let m_k = the median company revenue of the window's non-holiday days on weekday k (average of the middle two when the count is even). Then w(d) = min(1, 2·m_k / revenue(d)).
- **A5. Day counts.** n_k = the number of window days on weekday k with w > 0.
- **A6. Rates.** For any entity e (clinic, and from clinics: rep, state, lead, family) and measure x (revenue, orders, …): rate_e[k] = Σ over window days d on weekday k of w(d)·x_e(d), divided by n_k.
- **A7. New clinics.** A clinic whose first-ever order is in the reference date's calendar year has no rates.
- **A8. Company baseline.** The sum of non-new clinic rates.
  - *Dashboard only:* a slow buyer (not new, no revenue in the window, ordering in the analysis window, revenue in the prior 12 months) gets its own 12-month average per day (`CLINIC_LIFECYCLE.md`).
  - The emails don't apply this rule, and the cross-check reports the difference.
- **A9. Period baseline.** The sum of rate[weekday(d)] over the period's days. An unfinished last day uses the before-cut-off rate.
- **A10. Goal day weight.** For each day d of year Y:
  - ly = d − 364 days.
  - Normal(d) = the median of the revenue on the first four non-holiday days among ly ± 7, ly ± 14, ly ± 21, ly ± 28 (nearest first). Neighbours may be any day **before the goal year starts** (early January uses late December two years back). Days in the goal year are never used, so the year's goal is fixed on Jan 1. If fewer than four are found (the last days of December), use the median of those found.
  - W(d) = Normal(d) × (d's factor if d is a weekday holiday, else 1).
- **A11. Daily goal.**
  - T = the annual target.
  - S = the new-business goal. Default: Y−1 revenue of clinics whose first-ever order was in Y−1.
  - p_m = month m's share of that revenue.
  - New(d) = S · p_m(d) / (days in month m).
  - Existing(d) = (T − S) · W(d) / Σ over year W.
  - Goal(d) = Existing(d) + New(d).
  - Period goal = Σ Goal(d). Days outside year Y keep their baseline as the goal.
- **A12. Orders goal and splits.**
  - Orders goal = baseline orders × period revenue goal ÷ period revenue baseline.
  - Any entity's existing goal = existing goal × the entity's share of the period baseline.
  - The new goal is split the same way.

## 7. Decisions needed before building
1. The 2026 target: $130M, or a stretch number. Each extra $5M adds about 4% to every rep's goal.
2. Where the rep split comes from: the best-window share (as written, so reps get −11% to +22% over their recent pace), or each rep's share of the **last 13 weeks** (every rep gets the same stretch, +8.6% in November). The company baseline and goal are the same either way.
3. The outlier cap: 2× the weekday median (proposed), or another number.
4. **Holiday season (found 2026-11-10).** Several weekdays between Christmas and New Year's Day are not listed but run well below a normal day:
   - Dec 22–23 and Dec 29–30 ran at 0.56–0.77 of a normal day in 2023–25.
   - In 2026 the list has only Dec 24, 25 and 31, so Dec 21–23 and 28–30 carry a full-day goal.
   - Option: add these days to `holidays.csv` with their measured factors. This moves about $0.5M of goal from late December to the rest of the year, in both the emails and the dashboard.

## 8. Momentum: is the business speeding up or slowing down?
These are the three tiles at the top of the Overview: **Revenue**, **Orders (volume)** and **Average order value**. Above them is one sentence on whether volume or order value explains the revenue change. When revenue or orders is not Normal, the alert rail gets a card too.

The method is plain statistics: classical seasonal adjustment plus control-chart rules. Code: `analytics/momentumModel.ts`. Tests and simulation: `scripts/momentum.test.ts`.

**Why orders get their own tile.** A price change moves revenue but not order volume.
- After the February 2026 price increase, order value ran 15–18% above last year. Over the same months orders fell every month vs last year, reaching −18% over the 4 weeks to Nov 8.
- Revenue alone hid this for months.
- **Revenue vs last year is not shown until Feb 2027**, because the price increase inflates it. Orders vs last year are shown, since price doesn't affect them.

**Usual pace.** Each day's expected value is the seasonal strength × the usual level. This is computed separately for revenue and for orders.
- **Seasonal strength** = last year's normal level for that day (the A10 rule, smoothed to 12 days within ±6 weeks) × this year's holiday factor ÷ last year's trend (the 364-day average centred on that day).
  - Dividing by last year's trend matters. Comparing with last year directly would turn last year's growth into a fake slide this year.
- **Usual level** = the half-year (26 complete weeks) before the last 16 weeks.
- A price change is therefore part of the usual level once it is in that half-year. The step itself shows for a few weeks (revenue read "Rising" in Feb 2026) and then becomes normal.

**The three questions**, asked of complete Monday–Sunday weeks:
1. **How big?** The last 4 weeks vs usual, against the normal range ±2 bands. For your data the range is about ±4.3%.
   - Weekly noise σ is measured from week-to-week changes over the 52 weeks before the last 16, so a slow trend can't inflate it.
   - The 4-week band = σ × √(1/4 + 1/26) × 1.25.
   - The 1.25 allows for neighbouring weeks moving together (week-to-week correlation is 0.5–0.6). It was calibrated by simulation.
   - Before the weekly sums, each business day is capped at 3 robust SDs, so one extraordinary day can't look like a shift.
2. **How long?** Complete weeks in a row on the same side of usual, within the last 16. "Off usual since" is the first week of the current run of non-Normal weeks, from the week-by-week history.
3. **Which way?** The last 4 weeks vs the 4 before. Steady when the difference is within one band; otherwise improving or worsening.

**Light:**
- **Falling** (red) or **Rising** (solid green): outside the range **and** 5 or more weeks in a row.
- **Watch** (amber): outside the range, or 6 or more weeks in a row inside it (a slow drift).
- **Normal:** neither.
- From Dec 20 to Jan 3 the light can be Watch at most, because business runs at 40–80% of normal in that stretch (decision 4).

**Average order value** = revenue ÷ orders over the last 4 weeks, shown against last year and against the 12 weeks before. It is labelled "price & mix" and has no light of its own.

**Drivers.** The 3 states and 3 reps with the largest change in **orders** over the last 4 weeks vs their usual.
- An entity's usual = its orders on the same days last year × the company's usual-to-last-year ratio, so the gaps add up to the company's gap.
- A driver is **ongoing** when its 16-week change agrees in direction and is at least half its 4-week change. Otherwise it is **new**.

**Why these checks and not others** (tested Nov 2025 – Nov 2026, revenue and orders):
- A recent-days check (single days beyond 3 robust SDs) **fired 0 times in 54 weeks**. Daily swings are too large for single days to mean anything, so it was dropped.
- The 4-week level, a run rule and a CUSUM build-up check agreed 71–94% of the time. They are one signal, kept as "how big" and "how long".
- An 8-week slope test fired 10–11 times and rarely agreed with anything (±8.5% weekly noise), so it was replaced by "which way".

**Validation (2026-11-10):**
- **Simulation, 150 runs each:**

  | Case | Falling or Rising |
  |---|---|
  | Steady business (false alarms) | 3% |
  | One very bad day | 2% |
  | 5-week −8% dip | 81% |
  | 5-week −12% dip | 99% |
  | Slow slide to −12% | 93% |
  | Dip in weeks 5–8 that recovered | 3% |

- **Real data:**
  - Revenue went Falling or Rising around the late-2025 surge, the February 2026 price step and from Sep 2026.
  - Orders have been off usual since Feb 16 and Falling since March.
  - On Nov 8, revenue was −7.9% (8 weeks) and orders −12.5% (16+ weeks), with order value at $591, +14% vs last year.

**Where it shows.**
- The Overview tiles (team logins only, because they name states and reps).
- An alert-rail card, and with it a daily insight card.
- The snapshot step is `momentum:build` in `engine/builder.ts`. It runs before the main rebuild and is best effort: without it, the tiles stay hidden.
