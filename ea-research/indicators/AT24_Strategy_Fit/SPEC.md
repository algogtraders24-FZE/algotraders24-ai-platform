# AT24 Strategy Fit - specification (v1.00, MT5, H1)

Honest purpose: for the chart symbol, show how three plain rules (trend, breakout, reversion) performed in each of the 5 AT24 Regime AI market states, on the symbol's own history, with the number of trades and a luck test, and mark which rule fits the state the market is in now. It is a measurement of the past, not a forecast and not a signal service. Places no trades.

## 1. R&D result that decided the design (2026-11-18)
Out of sample (last 40 % of the H1 history of 13 symbols: EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, NZDUSD, EURJPY, USDCAD, XAUUSD, US30, US500, USTEC, BTCUSD), entry next open, hold 24 bars, result in ATR(14) units after spread, one trade per rule per 24 bars. States by the fixed centroids of Regime AI (SPEC of AT24_Regime_AI). Script and numbers: `test/rnd_strategy_fit.py`, `test/rnd_strategy_fit_result.json`.

| Rule | NOISY | WIDE SWING | STRONG MOVE | COMPRESSED | STEADY TREND |
|---|---|---|---|---|---|
| Trend (EMA50 / EMA200 aligned) | -0.30 (2/13 symbols positive) | +0.005 (8/13) | -0.25 (2/12) | -0.02 (9/13) | -0.13 (5/12) |
| Breakout (20-bar high / low) | -0.24 (2/13) | +0.03 (7/12) | -0.10 (2/5) | **+0.135 (9/13)** | +0.01 (6/13) |
| Reversion (RSI 14 below 30 / above 70) | -0.04 (4/12) | -0.34 (2/12) | -0.30 (4/11) | -0.51 (1/13) | +0.03 (8/12) |

Reading: the state matters a lot (breakout: -0.24 R in NOISY, +0.135 R in COMPRESSED; reversion: -0.51 R in COMPRESSED). Most cells are around zero or negative after costs; the only clearly positive pooled cell is breakout in COMPRESSED. Pooled results are averages over symbols; single symbols differ, which is why the product measures the chart symbol itself and shows n.

## 2. Rules (closed bar i, chronological arrays, only bars <= i)
- EMA with alpha = 2 / (span + 1), EMA_0 = C_0. `trend` = +1 if C_i > EMA50_i and EMA50_i > EMA200_i; -1 if C_i < EMA50_i and EMA50_i < EMA200_i; else 0.
- `breakout`: HH = max(H_{i-20..i-1}), LL = min(L_{i-20..i-1}); +1 if C_i > HH; -1 if C_i < LL; else 0.
- `reversion`: simple means of gains and of losses of C over the last 14 bars (U, D); RSI = 100 - 100 / (1 + U / (D + 1e-12)); +1 if RSI < 30; -1 if RSI > 70; else 0.
- State, ATR(14) and the validity (bar index >= 99) come from `AT24_RA_Core.mqh` unchanged. Signals are used from bar index 250 on (EMA warm-up).

## 3. Trades and statistics
- Signal at i with direction d: entry = O_{i+1}, exit = O_{i+25} (24 bars later). Needs i + 25 <= n - 1. R = (d * (exit - entry) - cost) / ATR14_i. `cost` = the symbol's current spread (ask - bid) at calculation time; swap is not included (24-hour hold).
- Per rule, trades are taken in bar order; after a taken trade the next one of the same rule must be at least 24 bars later (signals without a known exit are skipped and do not start the wait).
- A trade belongs to the state of its signal bar. History used: the last InpHistBars (default 20000) closed bars.
- Per cell (rule x state): n, average R, hit rate (R > 0), luck test p = share of 3000 random sign-flips of the cell's trade results whose mean is >= the real mean (xorshift32: x ^= x << 13; x ^= x >> 17; x ^= x << 5; seed 20261118 per cell; the low bit decides the sign; first draw is the first flip).
- Class of a cell: n < 30 -> no claim; n >= 30 and average > 0 and p < 0.10 -> FIT; n >= 30 and average < 0 -> AVOID; else NEUTRAL.

## 4. Output
Dashboard (default off in the Strategy Tester): the current state, for each rule the signal on the last closed bar (long / short / none) and the class of that rule in the current state, and the 3 x 5 grid of average R with n coloured by class. Arrow on the last closed bar only when a rule signals while its class in that state is FIT (historical bars never get arrows, because the class is measured with the whole history). Optional alert on that event. Buffers: 0-2 signals of trend / breakout / reversion on the last closed bar (+1 / -1 / 0), 3-5 class of each rule in the current state (1 FIT, 0 neutral or no claim, -1 AVOID).

## 5. Limits written on the product
Averages are measurements on past bars; classes change as history grows; small cells prove nothing (n shown). Spread is the current spread for all past trades. H1 only. Past results do not predict future results. Not financial advice.
