# AT24 Strategy Fit - brief

Three plain rules - trend (EMA 50 / 200), breakout (20-bar high / low) and reversion (RSI 14 below 30 / above 70) - measured on this symbol's own H1 history inside each of the 5 AT24 Regime AI market states: average R per trade (24-hour hold, after spread), number of trades and a luck test. The panel marks which rule is FIT, neutral or to AVOID in the state the market is in now, and shows each rule's signal on the last closed bar.

- Research (out of sample, 13 symbols incl. gold, forex majors, indices and Bitcoin): the market state changes the result of the same rule a lot - for example breakout was best after compression and worst in noisy markets, reversion worst after compression.
- Everything is a measurement of the past with n shown; a cell needs 30+ trades and a luck test before it can be called FIT. No forecast, no profit claim.
- Live arrow and optional alert only when a rule signals in a state where its own record is FIT. Buffers for EAs (signals, fit classes).
- Input: history bars, alert, dashboard. H1 charts. Platform: MT5. Price: 33 USD (series standard).
- Test status: 26 unit tests, independent Python check identical (signals, trades, statistics, luck test), no look-ahead test passed; alerts and live forward record not verified yet.

## v1.10
- Optional protective stop in the measured trades (default 2 ATR, 0 = none): the record, the FIT / AVOID classes and the panel note are measured with that stop, and the share of stopped trades is shown. A stop caps each loss; it does not create an edge.

## TradingView
- Pine v5 version with the same rules, states, optional stop and statistics; the luck test uses a different random generator (p can differ slightly from MT5), cost is a percent of the entry price.
