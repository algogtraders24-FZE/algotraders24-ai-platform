# Research sprint 2 - LONG + SHORT trend strategies (pre-registered BEFORE the first run)

Date written: 2026-10-23, before any of these three strategies was run. Same data, periods, costs and pass tests as PREREG.md (sprint 1, where none of six long-only strategies passed).
Paper only. Shorts are modelled like a 1x perpetual-futures short: profit when the price falls, same 0.15% cost per unit of turnover, total gross exposure (longs + shorts) never above 100% of equity,
no leverage. **Funding payments are ignored** (their sign changes over time: shorts usually receive them in bull phases and pay them in bear phases, so this can flatter or hurt the result).
No liquidation modelling is needed at 1x with 1/10 position sizes, but a real perpetual account adds funding, margin and exchange risk this test does not capture.

## The three strategies (parameters fixed now, never tuned)
- **S7 per-coin trend, long/short (1d):** for every coin, +1 (long) while close > its 100-day SMA, -1 (short) while below; each position weighs min(1/10, 1/active coins); gross exposure <= 100%.
- **S8 BTC trend, long/short (1d):** BTC only: +100% while close > 200-day SMA, -100% while below.
- **S9 cross-sectional momentum, long/short (1d):** every Sunday close rank the coins by 30-day return; long the top 5 and short the bottom 5 (1/10 each, roughly market neutral), held for the week, no regime filter.

## Periods
Development 2021-01-01 .. 2023-12-31 (includes the 2022 bear market). Holdout 2024-01-01 .. 2026-10-22. Nothing is tuned on either.

## PASS criteria (all must hold)
A. Holdout net total return > 0 **and** Sharpe >= 0.7.
B. Development Sharpe >= 0.5.
C. Max drawdown <= 40% in each period.
D. Holdout Sharpe above the 90th percentile of 100 random circular time-shifts of the strategy's own weights (long/short signs kept).
E. Enough trades: >= 100 position openings (sign changes into a position) for S7 and S9; for the single-asset S8 >= 30 (declared now because one asset cannot reach 100).

Strategies tried so far across both sprints: 9. With that many tries one lucky pass is plausible, so a pass only makes a strategy a CANDIDATE for a forward paper test, never a reason to trade money.
