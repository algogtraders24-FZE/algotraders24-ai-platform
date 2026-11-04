# AT24 Daily Risk Panel - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_DR_SelfTest.mq5` + `test/verify_dr.py`) | 6 deterministic scenarios (0-4 positions; gold-like and 5-digit forex tick values; long and short; a position without a stop; a stop beyond break-even; a day that loses 92 % of its limit; too many trades; open risk above the limit): per-position risk, open risk money and %, daily loss used %, no-stop count, over-limit count and every rule flag identical |
| MT5 live chart (portable terminal with a demo account, quiet day) | panel reads the account: day start balance 7,822.44, no trades today, 0 % of the daily limit, rules broken 0: test/mt5_daily_risk_panel_chart.png |
| NOT tested live | the broken-rule counter, alerts, trades-opened count and open-position risk were not exercised on an account with trades/positions today (none available in the test terminal); they rely on the verified core plus standard platform calls (`PositionGetDouble`, `HistorySelect`, global variables). Please test on a connected demo with a position before listing |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Behaviour
- Day = from the chosen broker hour; day-start balance = balance now minus today's deal flows (including deposits).
- Daily loss used = (closed result today + floating) / (day-start balance x your daily limit %), shown only while the day is losing.
- Open risk = money lost if every open position's stop is hit; a position with no stop counts as a broken rule and adds 0 to the risk figure (its real risk is unbounded). A stop at or beyond break-even adds 0.
- Rules (all your own inputs): daily loss limit, risk per trade, total open risk, trades per day. Each broken rule is counted once per day (global variable per rule and ticket) and alerts once. The panel only warns; it never closes, blocks or modifies trades.

## Notes / limits
- Not a replacement for a prop-firm rule checker: firms define daily loss, reset time and equity/balance basis differently (see AT24 Prop Guard / Guardian).
- Trade counting uses entry deals (a pending order that fills counts once; partial fills of one position count once per entry deal).
