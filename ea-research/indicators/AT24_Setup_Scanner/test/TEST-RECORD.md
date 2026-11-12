# AT24 Setup Scanner - test record (2026-11-12, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, engine, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_SS_SelfTest.mq5` + `test/verify_sp.py`, 8,000 H1 bars per symbol) | the scanner engine run for TWO symbols and dumped in the Setup Pro format: XAUUSD (real feed: 223 pullback + 120 squeeze setups, every setup and score identical to Python) and BTCUSD_T (a custom symbol built from Binance BTCUSDT H1, clearly test data: 226 pullback + 144 squeeze setups, every setup and score identical). The maths is the Setup Pro core (verified, see its record); the scanner adds the per-symbol bar fetch and wiring, which the two-symbol run exercises. |
| MT5 live chart (portable terminal) | watchlist table with trend, live-setup column, two scorecards per symbol, a missing symbol flagged, chance-passes line: test/mt5_setup_scanner_chart.png (symbols with history offline: XAUUSD, BTCUSD_T, EURUSD; US500 not available -> "no data / symbol not found"). The BTCUSD_T row is test data, not a broker symbol. |
| Loading other symbols | other symbols' history loads in the background: the scanner retries the missing rows every 10 seconds until every row has data (first screenshot showed "no data" until the retry was added). |
| Live setup in the table and alerts | NOT exercised: no setup formed on the last closed bar of the test symbols. Same event detection as the scorecards and as Setup Pro; needs a look on a live connected terminal. |
| Many symbols / performance | each symbol runs the full analysis once per new bar of the scanned timeframe (up to 20 symbols; two symbols took about one second). Not stress-tested with 20 symbols on a connected terminal. |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
For a watchlist (comma-separated symbols as the broker names them, up to 20) and one timeframe: for every symbol the trend state, the setup on the last closed bar (entry about the last close, stop, target) and the scorecard per setup type (trend pullback, squeeze release) on that symbol's own history: count, average R after cost, and a luck test; verdicts PASS (beats luck), NEGATIVE, none, or too few. It also shows how many scorecards passed against how many pure chance would give (5 % of the scorecards tested), so a lone pass in a long list is not mistaken for an edge. Optional alert and push at bar close for new setups. It places no trades.

## Real result (test feeds, H1, stop 1.5 ATR, target 2 R, cost = current spread)
XAUUSD: pullback -0.08 R (167), squeeze +0.03 R (90), none. BTCUSD_T (Binance test data): squeeze +0.27 R (106 setups, p 0.03 = PASS), the only pass in 6 scorecards (chance alone gives about 0.3): the kind of lone pass the chance line exists to qualify; EURUSD squeeze -0.31 R (NEGATIVE). Not a trading claim.

## Notes / limits
- In-sample scorecards on whatever history the terminal holds; the same multiple-testing caution as Setup Pro applies, now across symbols.
- A symbol the broker does not list (or with a suffix) shows "no data / symbol not found": the names must match the Market Watch.
- Dashboard off in the Strategy Tester by default.
