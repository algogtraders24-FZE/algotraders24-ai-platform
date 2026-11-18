# AT24 Strategy Fit Scanner - brief

One table for up to 24 symbols (forex majors, gold, silver, indices, Bitcoin by default): which of three plain rules (trend, breakout, reversion) signals on the last closed H1 bar, in which AT24 Regime AI market state, and how that rule performed in that state on the symbol's own history (average R, number of trades, luck test), plus the typical next 24 h range and the ATR. FIT signals are listed first.

- Same engine as AT24 Strategy Fit and AT24 Regime AI; every row can be checked against the single-symbol panels.
- The measured trade: next-open entry, 24 h hold, no stop, spread cost, R = 1 ATR. A measurement of the past, not a forecast; no profit claim.
- Optional alert when a rule signals in a state where its own record is FIT; buffer for EAs (number of FIT signals).
- Input: symbol list, broker suffix, history bars, rows, only-FIT filter, alert, dashboard. H1. MT5. Price: 33 USD (series standard).
- Test status: cores verified (26 + 23 unit tests, independent Python identical); scanner rows identical to the single-symbol panels; alerts and live forward record not verified yet.
