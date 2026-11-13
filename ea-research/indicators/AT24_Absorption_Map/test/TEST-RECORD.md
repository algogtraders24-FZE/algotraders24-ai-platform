# AT24 Absorption Map - test record (2026-11-13, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Whole chain vs independent Python (`mt5/AT24_AB_SelfTest.mq5` + `test/verify_ab.py`, 8,000 real XAUUSD H1 bars with tick volume; volume multiple 1.5 of the 20-bar average, range <= 1.0 ATR, push >= 1.0 ATR over 6 bars, stop buffer 0.25 ATR, target 2 R, 40-bar timed exit, cost 0.25) | everything is new in this indicator and recomputed in Python from the bars alone (ATR included): 94 absorption zones (bar, side, edges, ATR, first-touch bar; all 94 touched); trades for sellers-absorbed (39), buyers-absorbed (50) and all zones (89): entry, stop, target, risk, exit bar, result and R after cost identical; scorecards (resolved, wins, hit %, average R, total R, t, sign-flip p) identical. The touch / trade walk is the Zone Pro machinery, re-verified here on the new zones. |
| MT5 live chart (portable terminal, XAUUSD H1) | dashboard with nearest-zone plan and three scorecards: test/mt5_absorption_map_chart.png (scorecards equal the self-test). No FRESH zone existed on the test chart (all 94 historical zones had been touched), so the zone rectangles and the plan lines were not visible in this screenshot; the drawing code is the one seen live in Zone Pro. |
| Alerts (touch of a fresh zone) | not fired in the test (alerts off by default); needs a live connected chart |
| Non-repainting | a zone exists only after its heavy bar has closed; touches use closed bars only; history rebuilt once per bar |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
Finds absorption bars: tick volume well above the recent average (effort) but a small range (little result), right after a push in one direction. A fall that gets absorbed makes a demand-side zone, a rise that gets absorbed a supply-side zone (the bar's high-low range). Fresh zones are drawn with a ready plan for the nearest one on each side (limit at the near edge, stop beyond the far edge, 2R target), and the first return into every past zone is scored on the symbol's own history: sellers absorbed, buyers absorbed, all zones (count, hit rate, average R after cost, total R, luck test). Verdict POSITIVE / NEGATIVE ON THIS HISTORY only beyond luck, else NO EDGE SHOWN, TOO FEW under 30. Optional alert at bar close when a fresh zone is touched.

## Real result on this feed (XAUUSD H1, last 8,000 bars)
Sellers absorbed: 39 retests, hit 23 %, average -0.34 R after cost (p 0.94). Buyers absorbed: 50 retests, hit 42 %, average +0.23 R (p 0.13). All: 89 retests, hit 34 %, average -0.02 R (p 0.56): no edge shown for any group. Same honest picture as the rest of the series.

## Notes / limits
- Uses tick volume per bar (the number of quote changes), not real volume: absorption here means "many quote changes, little movement". It is a proxy for effort, not exchange order flow.
- The default thresholds were chosen to give a usable number of zones (stricter ones gave only 3 zones in 8,000 bars), not for results; with several inputs a lucky scorecard is easy to find (multiple testing). Past results do not predict future results.
- Both stop and target inside one bar count as the stop; slippage and gaps are not modelled; cost = current spread unless set. Dashboard off in the Strategy Tester by default.

## Live check (Engineering window, IC Markets demo XAUUSD M15, 2026-11-13)
Loads with no slow warning. 114 past retests: sellers absorbed 67 at +0.17 R, buyers absorbed 47 at -0.34 R (NEGATIVE ON THIS HISTORY), all -0.04 R. No fresh zone existed, so rectangles and the plan were not seen. Wording fix: the panel now says "A zone was touched on the last closed bar" (it could show "0 fresh zones" and "a fresh zone was touched" together, which confused). Same wording fix in Zone Pro.
