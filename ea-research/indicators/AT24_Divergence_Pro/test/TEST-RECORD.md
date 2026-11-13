# AT24 Divergence Pro - test record (2026-11-12, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Whole chain vs independent Python (`mt5/AT24_DV_SelfTest.mq5` + `test/verify_dv.py`, 8,000 real XAUUSD H1 bars; RSI 14, swings 5 bars each side, 6-60 bars apart, RSI difference >= 2, stop buffer 0.25 ATR, risk <= 4 ATR, target 2 R, 40-bar timed exit, cost 0.25) | everything recomputed in Python from the bars alone (ATR included): Wilder RSI (sampled values), confirmed swing lows/highs, 104 divergence events (bar, direction, swing, previous swing), trades for bullish only (43), bearish only (49) and all (85): entry, stop, target, risk, exit bar, result and R after cost identical; scorecards (resolved, wins, hit %, average R, total R, t, sign-flip p) identical |
| MT5 live chart (portable terminal, XAUUSD H1) | divergence lines on price between the two swings with arrows at the confirmation bar, scorecards: test/mt5_divergence_pro_chart.png (scorecards equal the self-test) |
| Live "divergence confirmed on the last bar" block and alerts | not exercised: no divergence was confirmed on the last bar of the test chart (alerts off by default); same detection as the history; needs a look on a live connected chart |
| Non-repainting | a swing point is used only after the k bars to its right have closed; the signal is the confirmation bar (so it arrives k bars after the swing); history is rebuilt once per bar |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
Finds RSI divergences between confirmed swing points (regular bullish: price makes a lower low while RSI makes a higher low; bearish mirrored), draws the line between the two swings and an arrow at the confirmation bar, shows the plan for a live one (entry about the last close, stop beyond the swing extreme, target as a multiple of the stop, skipped when the stop would be too far), and scores every past divergence on the symbol's own history (bullish, bearish, all): count, hit rate, average R after cost, total R and a luck test. Optional alert and push at bar close.

## Real result on this feed (XAUUSD H1, last 8,000 bars)
Bullish divergences: 43 trades, hit 37 %, average -0.17 R after cost (p 0.82). Bearish: 49 trades, hit 47 %, average +0.13 R (p 0.24). All: 85 trades, -0.04 R (p 0.61): no edge shown for any group. Same honest picture as the rest of the Research Lab.

## Notes / limits
- The signal necessarily comes k bars after the swing (no repainting); the entry is the next open after the confirmation bar, so a fast reversal may already be under way.
- Only regular divergence is included (no hidden divergence); several inputs can be tuned, which makes a lucky scorecard easy to find (multiple testing). Past results do not predict future results.
- Both stop and target inside one bar count as the stop; slippage and gaps are not modelled; cost = current spread unless set.
- Dashboard off in the Strategy Tester by default.

## Live-quote probe (Engineering window, 2026-11-13, IC Markets demo, connected)
The cost-from-spread input (InpCost 0) gave sensible values on live quotes (spreads: XAUUSD 0.15, EURUSD 0.0001, US500 0.5, BTCUSD 5.0). Alert and push firing once per bar still needs a real setup / touch / divergence to occur and is NOT yet verified.
