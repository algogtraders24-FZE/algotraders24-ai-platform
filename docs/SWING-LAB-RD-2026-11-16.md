# Swing Trading Lab: R&D, 2026-11-16

Question: do the four most popular swing-trading rules show a measurable edge on daily bars, on the markets AT24 covers?
Script: `ea-research/indicators/_lab/py/lab07_swing_daily.py` (rules and seeds fixed before any result was seen). Raw results: `ea-research/indicators/_lab/reports/lab07_results.json`.

## Method (pre-registered)

- Data: BTCUSDT and ETHUSDT daily bars from Binance spot (2017-08-17 to 2026-11-15, 3,378 days each); XAUUSD daily built from the hourly file (2021-05-05 to 2026-11-06, 1,415 days).
- Rules (long only, forward close-to-close return over H days from the signal close, no costs: this tests the signal, not a system):
  - W1 Trend: close above the 50-day average and the 50-day above the 200-day, H = 10.
  - W2 Pullback: uptrend (50-day above 200-day) and three down closes in a row, H = 5.
  - W3 Breakout: highest close of the last 20 days, H = 10.
  - W4 Oversold: RSI(14) below 30, H = 10.
- Events do not overlap (the next one may start H days later).
- Test: mean forward return of event days minus the mean of all other days (the unconditional drift), two-sided permutation test, 10,000 shuffles. 12 tests, Bonferroni alpha 0.05 / 12.
- Periods: train (first 60 %), validation (next 20 %), final (last 20 %). A finding needs p_train below alpha, the same sign in validation with p < 0.05 and in final.

## Result

No finding in 12 tests. The best looking numbers are the crypto trend and breakout rules in the training period (+2.1 % to +3.1 % over the average day, p about 0.13 to 0.17), and they disappear or reverse in validation and final. Gold shows nothing at all. RSI below 30 almost never happens on these daily series (2 to 21 events), so W4 cannot be judged.

| Asset | Rule | Train diff (n) | Validation diff (n) | Final diff (n) |
|---|---|---|---|---|
| BTC | trend | +2.55 % (54), p 0.13 | -0.28 % (40) | -0.82 % (22) |
| BTC | pullback | -1.16 % (38) | +0.04 % (31) | +0.44 % (25) |
| BTC | breakout | +2.08 % (68), p 0.17 | -0.36 % (32) | +1.37 % (21) |
| ETH | trend | +3.14 % (64), p 0.13 | -0.95 % (36) | +3.67 % (14) |
| ETH | pullback | +1.37 % (38) | -0.28 % (23) | -0.59 % (16) |
| ETH | breakout | +2.92 % (69), p 0.14 | -0.49 % (28) | -0.16 % (23) |
| XAU | trend | -0.24 % (35) | -0.27 % (26) | +1.42 % (12) |
| XAU | pullback | -0.44 % (25) | +1.43 % (9), p 0.06 | -0.38 % (14) |
| XAU | breakout | -0.65 % (27) | -0.08 % (17) | +0.70 % (8) |

## Limits

Daily bars give few non-overlapping events, so small edges would not be seen: the test can say "no edge large enough to detect", not "no edge exists". Costs, stops and position sizing are not modelled. One feed per asset. Only long trades.

## What this means for a product

A swing signal or "setup scanner" would be selling something the data does not support. What traders still lack, and what the data does not contradict, is process: where the multi-timeframe trend and the key levels are, how big to trade for a risk limit, and what their own swing trades really did. A Swing Lab built from those (a multi-timeframe trend and level map for the markets we cover, a swing position planner, and the forward scoreboard approach we already use) stays honest.
