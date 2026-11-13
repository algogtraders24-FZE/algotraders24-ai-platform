# AT24 Setup Pro - test record (2026-11-12, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_SP_SelfTest.mq5` + `test/verify_sp.py`, 8,000 real XAUUSD H1 bars, stop 1.5 ATR, target 2 R, 40-bar timed exit, cost 0.25) | the NEW layer is verified: setup levels (entry = next open, stop, target, risk), the forward walk (stop first if both hit in one bar, timed exit at the close, still-open flag), outcome in R after cost, non-overlap per type, and the scorecard (resolved count, wins, hit %, average R, total R, t, sign-flip p): pullback 223 setups and squeeze 120 setups, every setup and every score identical. The pullback and squeeze EVENT detection comes from the AT24 Trend Pullback Map and Squeeze Meter cores, each already verified against Python (their own test records); ATR is recomputed in Python. |
| MT5 live chart (portable terminal, XAUUSD H1) | multi-timeframe trend panel, scorecards, drawn setups (arrows, result lines): test/mt5_setup_pro_chart.png. Scorecards on the chart equal the self-test (223 setups -0.05 R, 120 setups -0.01 R). |
| Live "setup on the last closed bar" block and alerts | The block (entry shown at the last close, stop, target, alert + push at bar close) was not exercised: no setup formed on the last bar of the test chart. Code path = same event detection as the history; needs a look on a live chart when a setup forms. |
| Non-repainting | all detection and scoring uses closed bars only (CopyRates from shift 1); a setup appears when its signal bar has closed; history is rebuilt once per bar. |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
Detects two setup types on the chart timeframe (trend pullbacks inside an EMA-ribbon trend, squeeze releases), builds the complete trade for each (entry at the next open, ATR-based stop, target as a multiple of the stop, timed exit) and walks every historical setup forward on the symbol's own bars to get its real outcome in R after cost. Per setup type the dashboard shows the count, hit rate, average R after cost, total R and a luck test (sign-flip p); the verdict says POSITIVE / NEGATIVE ON THIS HISTORY only when the result is beyond luck, otherwise NO EDGE SHOWN, and TOO FEW below 30 setups. A trend panel shows the four timeframes (M15, H1, H4, D1) and whether they are aligned. The last N setups are drawn with their outcome. Alerts at bar close (optional, push optional).

## Real result on this feed (XAUUSD H1, last 8,000 bars)
Trend pullback: 223 setups, hit 33 %, average -0.05 R after cost (p 0.72): no edge shown. Squeeze release: 120 setups, hit 33 %, average -0.01 R (p 0.52): no edge shown. Consistent with Research Lab 01-06: no stable edge. The tool's value is the levels, the discipline and the honest scorecard, not a promise.

## Notes / limits
- The scorecard is in-sample on the history the terminal holds; a setup can look good by chance (multiple testing: two types times the user's parameter choices). Past results do not predict future results.
- Both-in-one-bar is counted as a stop; gaps and slippage are not modelled; the cost is the current spread unless set.
- Dashboard off in the Strategy Tester by default.

## Live-quote probe (Engineering window, 2026-11-13, IC Markets demo, connected)
The cost-from-spread input (InpCost 0) gave sensible values on live quotes (spreads: XAUUSD 0.15, EURUSD 0.0001, US500 0.5, BTCUSD 5.0). Alert and push firing once per bar still needs a real setup / touch / divergence to occur and is NOT yet verified.
