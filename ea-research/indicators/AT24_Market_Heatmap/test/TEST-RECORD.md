# AT24 Market Heatmap - test record (2026-11-13, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_HM_SelfTest.mq5` + `test/verify_hm.py`) | every heatmap field recomputed in Python from the daily bars of two symbols (XAUUSD real feed, 1,500 bars; BTCUSD_T = Binance test data in a custom symbol, 1,500 bars): last close, 1 / 5 / 21-day change, ATR % of price, last move in ATRs of the previous day, EMA50/200 trend state, Wilder RSI, 52-week range position and distance from the 52-week high: identical on both symbols |
| MT5 live chart (portable terminal) | watchlist table with heat colours (green up, red down), live "Today" column, move/ATR flag, trend and RSI, 52-week position, missing symbols flagged: test/mt5_market_heatmap_chart.png (symbols with daily history offline: XAUUSD and the test symbol BTCUSD_T; the others show "no data / symbol not found") |
| Alerts (abnormal daily move) | not fired in the test (no symbol had a 2 ATR daily move); needs a look on a live connected terminal. One alert per symbol per daily bar. |
| Many symbols | up to 25 symbols; other symbols load in the background and missing rows retry every 10 seconds; not stress-tested with 25 symbols on a connected terminal |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
One panel for a watchlist across forex, metals, energy, indices, stocks and crypto (symbols exactly as the broker names them): last price, the live move today, the closed-bar change over 1, 5 and 21 days, ATR as a percent of price, the size of the last closed daily move in ATRs (a "!" marks an abnormal one; optional alert and push), the EMA trend state with RSI, and where price sits in its 52-week range. Rows can be sorted by the biggest move in ATR, today, 21 days or list order. Descriptive only.

## Notes / limits
- Daily bars of the broker: the "52 weeks" are the last 252 daily bars; weekend and holiday bars follow the broker. Stock and index CFD symbols without 260+ daily bars show "no data".
- The live Today value uses the current bid against the last closed daily close.
- Dashboard off in the Strategy Tester by default.
