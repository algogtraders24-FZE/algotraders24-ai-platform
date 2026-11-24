# Pro Chart: which strategy features are free and which are paid (plan for the owner)

Status: plan, 2026-11-24. Nothing here is built yet; it needs the owner's decisions in section 5. Written after the free-trial rule for Analyze (30 days, 10 a day, then a paid plan) went live.

## 1. What exists today (checked in the code)

| Feature | Where | Who can use it today |
|---|---|---|
| Structure Retest watching card | Strategies tab | everybody (labelled FREE) |
| My signals (record of the plans Analyze generated, with measured outcomes) | Strategies tab | everybody who has run Analyze |
| Strategy Tester, registry strategies (2 today: Golden, EMA crossover) | drawer under the chart | **everybody, no paid check** on the run route |
| Strategy Tester, AI Strategy (natural language) | same dialog | paid plans only (`hasQuantProAccess`) |
| Build with AI (Quant Chat) | link to /dashboard/quant-chat | paid plans (monthly AI credit limit) |
| Gallery (strategy library) | link to /dashboard/algo-test-library | page open to everybody |
| Optimization and walk-forward | separate pages | paid |
| Live paper execution of a strategy | separate page | paid |
| Auto-trading bots | Strategies tab card "Advanced plan" | not built |

Two things stand out. The registry backtest is open to every user, and since the 2-year history change it is also the most expensive thing a free user can start (up to ~40 Exness pages, about 90 seconds for 138 days of M5).

## 2. Principles

1. Free users get a real taste, paid users get depth and speed. The chart, indicators, drawing tools and the signal record stay free.
2. Anything that costs us money per click (AI compile, long data fetches) has a daily limit for free users and a higher one for paid users, counted in the database like the Analyze limit.
3. Never claim results. Every backtest shows its assumptions (no spread or commission) as it does now.

## 3. Proposed split

| Feature | Free (first 30 days) | Free (after 30 days) | Pro and above |
|---|---|---|---|
| Structure Retest watching card | yes | yes | yes |
| My signals record | yes | yes (read only) | yes |
| Registry backtest | 3 runs a day, windows up to 90 days | 1 run a day, 30 days | 30 runs a day, up to 2 years |
| AI Strategy backtest | no (shows the upgrade note) | no | yes, with a daily cap |
| Build with AI | 1 sample build to see how it works | no | yes, with a daily cap |
| Gallery | browse | browse | browse and save |
| Optimization, walk-forward | no | no | yes |
| Live paper execution | no | no | yes |
| Auto-trading bots (later) | no | no | Advanced plan |

The exact numbers (3, 1, 30, 90 days) are my suggestion; they live in one config file like the Analyze limits, so they can be changed without code changes elsewhere.

## 4. How it would be built (reusing what exists)

- Same pattern as the Analyze limit: pure rules in `lib/access`, a service using the `RequestLog` table (new types `algo_test_run`, `ai_build`), no schema change.
- Enforce on the server in `/api/private/algo-test/runs` (registry) and the AI routes; the range cap per timeframe becomes plan-aware (`maxRangeDaysFor` gets an `isPro` argument; free users get the shorter caps).
- The panel shows the same kind of line as the Analyze counter ("2 of 3 backtests left today") and the upgrade note.
- Strategy cards in the Strategies tab get a FREE or PRO badge so the split is visible.
- Estimated work: about 1.5 days including tests.

## 5. Decisions needed from the owner

1. Is the table in section 3 right, or should registry backtests stay open to free users with only a window limit?
2. Daily numbers for free and Pro (my suggestion above).
3. Should the 30-day free period apply to backtests too (same clock as Analyze), or should backtests be limited from day one?

## 6. One engineering risk to plan for now

All Exness history is read with one API key. If many users start long backtests at the same time, they share one rate limit and some runs will fail or wait. Before this is opened widely we should add a shared candle cache in our own database (for the main symbols on H1, H4 and D1, topped up daily), so repeat runs do not hit Exness at all. This also makes runs much faster than the 90 seconds seen today. Estimated work: about 2 days.
