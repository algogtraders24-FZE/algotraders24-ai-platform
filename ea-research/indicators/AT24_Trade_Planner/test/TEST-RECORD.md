# AT24 Trade Planner - test record (2026-11-12, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_TP_SelfTest.mq5` + `test/verify_tp.py`, XAUUSD symbol values: tick size 0.01, tick value 1.00 per lot, volume 0.01-100 step 0.01) | 8 long / short scenarios (stops 0.8-30 USD, R:R 0.8-3.0, risk 20-1000 USD, spread, commission, daily allowance): lots (rounded down to the step), money at risk, money at target, R:R, spread cost, commission, cost share of reward and daily-allowance share identical (8 of 8); a stop on the wrong side of the entry is rejected (lines flagged, 0 lots) |
| Platform cross-check (`OrderCalcProfit`) | NOT possible on the offline portable terminal (no quotes: the call returns 0, tick value loss is 0 and the contract-size fallback was used). To be run on a connected terminal: loss at stop and profit at target for the planned lots must equal the platform values within 0.2 %. Margin (`OrderCalcMargin`) shows "n/a" offline for the same reason. |
| MT5 live chart (portable terminal, XAUUSD H1) | first placement of the three lines (1.5 ATR stop, 2R target), panel with lots / money / costs / daily limit: test/mt5_trade_planner_chart.png |
| Interactive dragging | the drag handler (`CHARTEVENT_OBJECT_DRAG` recomputes at once; the 2-second timer also recomputes) was not exercised by a mouse in the headless terminal; the recomputation path itself is the same function as the timer and the first placement, which the screenshot shows. Needs a look on a connected terminal. |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
Three draggable horizontal lines on the chart (Entry white, Stop red, Target green). From them and the risk rule (percent of balance or a money amount): direction, lots rounded down to the volume step, money at the stop and at the target, R:R, margin (platform call), spread plus commission as a share of the reward, and the share of today's remaining daily loss allowance (limit % of balance plus today's realised result) the trade would use. Warnings: lines on the wrong sides, lots capped or too small, stop closer than the broker minimum distance. It places no orders and writes nothing to the account.

## Notes / limits
- A calculator: the quality of the answer depends on the entry price the user will really get; slippage, gaps and swap are not included; the spread is the current one.
- Tick value comes from the platform (loss side). Only when it is unavailable and the profit currency equals the account currency does it fall back to tick size x contract size (the panel says so).
- Today's allowance uses closed results of the day only (floating profit/loss is not counted).
- Dashboard off in the Strategy Tester by default; the lines are not created in the tester.
