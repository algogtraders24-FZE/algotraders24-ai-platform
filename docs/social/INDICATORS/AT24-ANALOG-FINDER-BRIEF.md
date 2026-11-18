# AT24 Analog Finder - brief

Finds the 30 most similar past H1 situations of the chart symbol (at least 24 bars apart) and shows what happened in the 24 hours after each of them: median and 80 % band in ATR units and in price, the share that went up, a histogram of the outcomes, and arrows on the chart at the analog bars.

- A built-in self-test on the symbol's own history says how reliable this look-up has been there: how often the 80 % band held, and whether the direction the analogs agreed on beat a luck test. On most symbols we tested it did not, and the panel says so ("direction NOT RELIABLE here").
- Research (13 symbols, out of sample): the analogs' 10 - 90 % band held about 76 % of the time; direction hit 52 % on average and passed the luck test on only 2 of 13 symbols.
- A look-up of the past, not a forecast; no buy or sell signal, no profit claim.
- Buffers for EAs: median, band low, band high (price), share up, band held, direction hit rate.
- Input: bars used, chart markers, dashboard. H1. MT5. Price: 33 USD (series standard).
- Test status: 32 unit tests; independent Python check identical (the same 30 analog bars, statistics, self-test and luck test) on 5 symbols; no look-ahead test passed; forward record not verified yet.
