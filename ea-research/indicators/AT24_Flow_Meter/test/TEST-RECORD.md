# AT24 Flow Meter - test record (2026-11-13, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core vs independent Python (`mt5/AT24_FM_SelfTest.mq5` + `test/verify_fm.py`) | REAL mode (buyer / seller flagged trades) and TICK-RULE mode on 83,924 real Binance BTCUSDT trades (44 one-minute bars): per-minute delta and tick counts identical to Python in both modes; BAR PROXY (tick volume x (close - open) / (high - low)) and the daily-restart cumulative delta on 3,000 real XAUUSD H1 bars identical. On that trade sample the tick rule tracked the true delta with correlation 0.931 (same sign in 91 % of minutes), matching the earlier 0.94 measurement. |
| MT5 live chart (portable terminal, XAUUSD H1) | offline terminal has no tick history, so the indicator correctly shows "BAR PROXY (estimate)": delta histogram (lighter colours = proxy bars), daily cumulative delta line, delta divergence marks on the price chart: test/mt5_flow_meter_chart.png |
| Tick modes inside the indicator (`CopyTicksRange`, mid price of bid/ask, buy/sell flags, 5 % flagged-ticks rule for REAL) | NOT exercised on a real feed: the offline terminal has no ticks. The maths is verified (above); the tick fetch and the REAL/TICK-RULE badge need one run on a connected terminal. On the IC Markets demo (Engineering window probe) forex, gold, index and BTC CFD ticks carry no buy/sell/last flags and no volume, so there the badge must read TICK-RULE ESTIMATE; REAL needs an exchange-feed broker. |
| Divergence alert | not fired in the test; needs a live chart. Marks use the verified swing/divergence logic of Divergence Pro on the cumulative delta instead of RSI. |
| MT4 / TradingView | not built (MT5 only; the bar-proxy mode could be ported) |

## What it does
A sub-window with the delta of every bar (histogram) and the cumulative delta (restarts every day), and a badge that says what kind of delta it is: REAL (the terminal's ticks carry buyer / seller flags: at least 5 % of the recent ticks), TICK-RULE ESTIMATE (price up = buy, down = sell, unchanged keeps the last direction, on the bid/ask mid price) for the most recent bars where tick data exists, and BAR PROXY (from the bar shape and tick volume) for everything older or when no tick data is available. Delta divergences (price makes a new swing extreme but cumulative delta does not) are marked on the price chart, confirmed on closed bars only.

## Notes / limits
- Only the REAL mode is order flow. The others are estimates: on trade prints the tick rule tracked true delta well (0.93-0.94 correlation, one liquid market, short samples); on CFD quote ticks it can be noisier and has not been measured against truth (no truth exists there). The bar proxy tracked 0.83 on the same trades.
- Brokers keep little tick history: only the most recent bars can use ticks (default 300); older bars always use the bar proxy. Bars that mix sources are shown with different shades.
- Delta divergence is context, not a signal: no edge claim; Labs and the web evidence found none for it.
- Not shown in the Strategy Tester (bar proxy only there).

## Live check (Engineering window, IC Markets demo, 2026-11-13)
No "indicator too slow" warning; BTCUSD M15 drew the delta histogram, the daily cumulative line and 2 divergence marks. The badge read BAR PROXY (estimate) on XAUUSD and BTCUSD even with the tick-bar input at 20, because the demo keeps almost no tick history for the last bars (CopyTicksRange returned nothing): the TICK-RULE ESTIMATE colours were not seen live. Change: the minimum of the tick-bar input is now 5 so the tick path can be tried with very few bars. The divergence alert was not seen to fire.
