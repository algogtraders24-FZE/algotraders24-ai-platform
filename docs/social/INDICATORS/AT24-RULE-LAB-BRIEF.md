# AT24 Rule Lab - brief

Six popular indicators - KAMA, FRAMA, HMA, TSI, Vortex and Squeeze - turned into plain long / short rules and measured on the chart symbol's own H1 history inside each of the 5 AT24 Regime AI market states: average result per trade (24-hour hold, optional protective stop, after spread), number of trades and a luck test. The panel shows each rule's signal on the last closed bar, its own record in the market state you are in, and a 6 x 5 grid. Underneath, the AT24 Analog Finder block: what followed the 30 most similar past situations.

- Research (13 symbols, out of sample): most cells are negative after costs and every rule is worst in noisy markets; the clearest positive cells were HMA in strong moves and the Squeeze release after a compression. Nothing is sold as an edge: the value is seeing where each popular indicator has been used badly or well on your symbol.
- A measurement of the past, not a forecast; no profit claim. With 30 cells some FIT cells appear by chance (n and the luck test are shown).
- Optional arrow and alert when a rule signals in a state where its own record is FIT; buffers for EAs (six signals, six classes).
- Input: bars used, optional stop, analog block, alert, dashboard. H1. MT5. Price: 33 USD (series standard).
- Test status: unit tests, independent Python check identical (signals of all six rules, states, trades, stop, statistics, luck test) on 5 symbols; no look-ahead test passed; alerts and forward record not verified yet.
