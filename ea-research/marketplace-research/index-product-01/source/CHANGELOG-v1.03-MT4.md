# AT24 Index Breakout MT4 v1.03 (from XXX Multi-Index MT4 v1.02)

Compiles with the MT4 MetaEditor: 0 errors, 0 warnings. NOT run in the Strategy Tester or on a demo.
v1.02 evidence does not apply to this version.

## Fixes (MT4-specific bugs are marked MT4)
| # | Problem in v1.02 | v1.03 |
|---|---|---|
| 1 MT4 | The daily trade limit counted EVERY closed order of the day, including pending stop orders the EA itself deleted (each stale or replaced order counted as a trade), and ignored the trade that was still open. The limit was reached by cancelled orders alone. | Counts market trades (buy/sell) opened today, open or closed. |
| 2 | Profit factor was net profit / number of losing trades; last-5 list and totals included deleted pending orders and balance rows. | Gross profit / gross loss; only closed buy/sell trades are listed or counted. Stats refresh only when the history length changes. |
| 3 | Every new bar added 3 modules x 2 sides of new pending orders next to the old ones; nothing stopped a module adding to its own open trade. | One order per module and side (replaced each bar), one trade per module (InpOneTradePerModule), cap on open trades (InpMaxOpenPositions, default 3). |
| 4 | Prop mode measured from today starting equity; daily-loss limit only without prop mode; every pause cleared next day. | Start balance (InpPropStartBalance or the balance at first start, remembered); prop lock stays; daily-loss limit independent; manual PAUSE stays until RESUME. |
| 5 | Distances were points x broker point (120 points = 120 index points only if the broker point is 1.0). | InpPointMode = PM_INDEX (default): 1.0 = one index point on every broker; PM_BROKER restores the old behaviour. OnInit prints the real distances and warns if the stop is under 3x the spread. |
| 6 | Lot not normalised; no margin check. | NormalizeLot (min/max/step) and AccountFreeMarginCheck before every order. |
| 7 MT4 | Eclipse required an upper AND a lower fractal on the same single bar (bar 2). That practically never happens, so Eclipse almost never traded. | Latest real upper and lower fractal within 60 bars. |
| 8 MT4 | Zenith used 12 bars (the MT5 build and the label say 20). | InpZenithBars input, default 20. If your v1.02 MT4 results came from 12, set it to 12 to compare. |
| 9 | No licence check. | AT24 licence guard (activate on start, re-validate every 24 h, no new trades if invalid, open trades still managed, skipped in the tester). |
| 10 | Stop-level not checked on stop-loss changes; trade-lock array never cleaned. | Checked before every change; stale locks removed. |

## Behaviour that changed on purpose
Fixes 1, 3, 5, 7 and 8 change what the EA does. Run a fresh backtest and a demo before this is sold, and publish only that evidence.

## Before it is sold
- AT24_TRADING_SYSTEM_ID / AT24_VERSION_ID at the top are placeholders (INDEX-BREAKOUT, INDEX-BREAKOUT-v1.03) and must equal the registered TradingSystem / Version. The MT4 build sends platform MT4, so the listing needs an MT4 release.
- The buyer must add https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest.
- Deliver the compiled .ex4 only, never the .mq4.
- MT4 shows only the history loaded in the Account History tab; for the stats to cover everything, set it to All History.
- Do not market it as AI: it is a rule-based breakout with an EMA trend filter.
