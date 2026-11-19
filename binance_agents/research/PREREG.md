# Research sprint - pre-registration (written BEFORE the first run)

Date written: 2026-10-23. Data: Binance Spot candles of 30 liquid USDT pairs, 2021-01-01 .. 2026-10-22 (1h, resampled to 4h / 1d). Long-only spot, no leverage, cash earns 0.
Costs: 0.10% fee + 0.05% slippage per side (0.15% per unit of turnover). Signals use only bars up to and including the close of bar t; they trade at the OPEN of bar t+1.

## The six strategies (parameters fixed now, never tuned afterwards)
1. **S1 cross-sectional momentum (1d):** every Sunday close rank the 30 coins by 30-day return; hold the top 5 (equal weight, only those with a positive 30-day return) for the week; hold only cash when BTC is below its 200-day SMA.
2. **S2 per-coin trend (1d):** hold every coin whose close is above its 100-day SMA, equal weight, at most 10 positions' worth of exposure (1/10 each; total exposure never above 100%).
3. **S3 BTC trend (1d):** hold BTC while it is above its 200-day SMA, otherwise cash.
4. **S4 dip in an uptrend (1d):** buy a coin when RSI(2) < 10 and close > 200-day SMA; exit when RSI(2) > 70 or after 7 days; 1/10 per position.
5. **S5 volatility squeeze breakout (4h):** buy when close breaks above the upper Bollinger band(20,2) within 3 bars of the band width being in its lowest 10% of the last 100 bars; exit when close < the 20-bar mean or hits a 3xATR(14) trail from the highest close; 1/10 per position.
6. **S6 equal-weight everything above the 50-day SMA that is also up over 90 days (1d):** 1/10 per coin, exposure capped at 100%. (A slower, broader trend filter.)

Benchmarks (information only): BTC buy & hold, equal-weight basket of the coins that exist.

## Periods
Development 2021-01-01 .. 2023-12-31. Holdout 2024-01-01 .. 2026-10-22. Nothing is tuned on either; both are reported.

## PASS criteria (all must hold; otherwise the strategy is NOT a candidate)
A. Holdout: net total return > 0 **and** Sharpe >= 0.7.
B. Development: Sharpe >= 0.5 (it must not be a one-regime accident).
C. Max drawdown <= 40% in each period.
D. Timing edge: the holdout Sharpe must beat the **90th percentile** of 100 random circular time-shifts of the strategy's own weights (same exposure, same turnover, timing decoupled from the market).
E. At least 100 entries over the whole sample (otherwise too few to mean anything).

With six strategies tried, one "pass" by luck is plausible (multiple comparisons). A pass only makes a strategy a CANDIDATE for a forward paper test in the arena - never a reason to trade money.
