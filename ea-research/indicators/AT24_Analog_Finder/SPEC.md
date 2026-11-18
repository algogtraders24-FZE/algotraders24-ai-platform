# AT24 Analog Finder - specification (v1.00, MT5, H1)

Honest purpose: find the past H1 situations of the chart symbol that look most like the last closed bar, show what happened in the 24 hours after each of them (size and direction, in ATR units and in price), and test on the symbol's own history how reliable that kind of look-up has been. It is a look-up of the past, not a forecast. No signals, no trades.

## 1. R&D result that decided the design (2026-11-18)
Walk-forward style test (`test/rnd_analogs.py`): 13 symbols (Exness H1), analogs from the first 60 % of the history, test points = every 24th bar of the last 40 % (non-overlapping), K = 30 analogs that are at least 24 bars apart, features z-scored, Euclidean distance. Outcome = (C_{i+24} - C_i) / ATR14_i.
- **Direction:** trading the side the analogs agree on (60 % or more up, or 60 % or more down) hit 52.3 % on average over the 13 symbols (range 46.6 % - 56.5 %); only 2 of 13 symbols passed a sign-flip luck test at p < 0.10 (USTEC p 0.01, US30 p 0.07, both indices with a strong upward drift where "always long" is as good). No reliable direction edge, so none is claimed.
- **Size and spread:** the analogs' 10 % - 90 % band of the next 24 h move held in 71.5 % - 79.1 % of the test points (mean 75.7 %; an 80 % band). Spearman correlation between the analogs' interquartile spread and the real miss 0.05 - 0.23. The band is a reasonable (slightly narrow) picture of how wide the outcomes were, not a precise one.
- Consequence: the product shows the distribution of what followed similar situations and its own reliability test on each symbol; it never turns the analogs into a buy / sell arrow.

## 2. Features of a closed bar i (chronological arrays, index 0 oldest; only bars <= i; valid from bar 250)
ATR14 = simple mean of the true range over 14 bars (TR_0 = H - L).
- f0..f5: (C_i - C_{i-n}) / ATR14_i for n = 1, 3, 6, 12, 24, 48.
- f6: ln(ATR14_i / ATR100_i).
- f7: (RSI14_i - 50) / 25 with simple means of gains and losses (RSI = 100 - 100 / (1 + U / (D + 1e-12))).
- f8..f10: (C_i - EMA_s,i) / ATR14_i for s = 20, 50, 200; EMA alpha = 2 / (s + 1), EMA_0 = C_0.
- f11: (C_i - min L_{i-47..i}) / (max H_{i-47..i} - min L_{i-47..i} + 1e-12).
Outcome y_i = (C_{i+24} - C_i) / ATR14_i, known for i <= n - 25.

## 3. Scaling and analog search
- Mean and population standard deviation (+ 1e-12) of every feature over the rows from bar 250 to the end of the first 60 % of the rows with a known outcome (rows 250 .. s, s = 250 + floor(0.6 x (n - 25 - 250))). The same scaling is used for the live query and for the self-test.
- Query = the last closed bar (index n - 1). Candidates = rows 250 .. n - 25.
- Distance = Euclidean distance of the z-scored 12 features. Analogs = greedy by distance: take the nearest candidate, remove every candidate within 24 bars of it (both sides), repeat until K = 30 analogs (fewer if the history runs out).
- Statistics of the analog outcomes: mean, quantiles 10 / 25 / 50 / 75 / 90 (linear interpolation), share with y > 0, mean distance. Price view: C_{n-1} + q x ATR14_{n-1}.

## 4. Self-test on the symbol's own history
Test points: j = s + 1, s + 1 + 24, ... while j <= n - 25 (rows after the scaling sample; non-overlapping). For each j the analogs are searched among rows 250 .. j - 24 (their outcome was known at j) with the same rules. Per test point: share up u, median m, 10 / 90 quantiles, the real y_j. Results:
- Band: share of test points with q10 <= y_j <= q90 (an 80 % band).
- Direction: test points where u >= 0.6 or u <= 0.4; side = up if u >= 0.5 else down; result R = side x y_j; hit rate = share with R > 0; average R; luck test = `AT24SF_CellOf` (3000 sign flips, xorshift32, seed 20261118) on the list of R; p < 0.10 and average > 0 is printed as "direction worked on this symbol", otherwise "direction not reliable here". With fewer than 30 selected points: "too few".
- For comparison: average of y_j over all test points (always long).

## 5. Output
Dashboard (default off in the Strategy Tester): analog count and mean distance, median / band / share up with price levels, a histogram of the analog outcomes, and the self-test with its verdict. Chart: small markers at the analog bars (up arrow when the 24 h after it was up, down arrow when down), optional. Buffers: 0 median, 1 q10, 2 q90 (price levels), 3 share up, 4 band held in the self-test, 5 direction hit rate in the self-test (last closed bar). The self-test is recomputed every 24 H1 bars; the search every new bar.

## 6. Limits written on the product
Similar does not mean the same: the features describe the last two days of price only. The band is slightly narrow; direction was not reliable on most symbols. Past results do not predict future results. Not financial advice.
