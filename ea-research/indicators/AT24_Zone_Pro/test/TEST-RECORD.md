# AT24 Zone Pro - test record (2026-11-12, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Whole chain vs independent Python (`mt5/AT24_ZN_SelfTest.mq5` + `test/verify_zn.py`, 8,000 real XAUUSD H1 bars, impulse 1.5 ATR, base 0.9 ATR / 3 bars, height 2 ATR, stop buffer 0.25 ATR, target 2 R, 40-bar timed exit, cost 0.25) | everything is new in this indicator and recomputed in Python from the bars alone (ATR included): 187 zones (position, direction, edges, ATR, first-touch bar), 166 touched; trades for demand only (76), supply only (81) and all (146): entry, stop, target, risk, exit bar, result and R after cost identical; scorecards (resolved, wins, hit %, average R, total R, t, sign-flip p) identical |
| MT5 live chart (portable terminal, XAUUSD H1) | fresh supply zones drawn as rectangles, nearest zone plan, three scorecards: test/mt5_zone_pro_chart.png (scorecards equal the self-test: demand 77 -> 76 in the self-test because the live chart had one more closed bar; same method) |
| Alerts (touch of a fresh zone) | not fired in the test (alerts off by default; the touch itself is the same detection as the scorecard); needs a look on a live connected chart |
| Non-repainting | zones are created only after the impulse bar has closed; a zone is touched or not by closed bars only; history is rebuilt once per bar |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
Finds supply and demand zones (a short base of small bars followed by an impulse bar that closes beyond the base), draws the fresh ones on the chart with a ready plan for the nearest one on each side (limit at the near edge, stop beyond the far edge, target as a multiple of the stop), and scores the FIRST return into every past zone on the symbol's own history: demand, supply and all zones, as count, hit rate, average R after cost, total R and a luck test (sign-flip p). Verdict POSITIVE / NEGATIVE ON THIS HISTORY only beyond luck, else NO EDGE SHOWN; TOO FEW under 30 retests. Optional alert at bar close when a fresh zone is touched.

## Real result on this feed (XAUUSD H1, last 8,000 bars)
Demand zones: 76 retests, hit 37 %, average +0.09 R after cost (p 0.29). Supply zones: 81 retests, hit 28 %, average -0.19 R (p 0.90). All zones: 146 retests, average -0.02 R (p 0.58): no edge shown for any group. Consistent with the Research Lab results: no stable edge. The tool's value is the levels and the honest scorecard.

## Notes / limits
- In-sample scorecards; the zone definition has several parameters, so a user who tunes them until a scorecard passes will find a lucky one (multiple testing). Past results do not predict future results.
- Entry assumes the limit order at the near edge fills when price reaches it (gap = open price); both stop and target inside one bar count as the stop; slippage and gaps are not modelled; cost = current spread unless set.
- A zone is touched by the first bar that reaches it, even if that bar also closes through it. Untouched zones expire after the max age (200 bars by default).
- Dashboard off in the Strategy Tester by default.

## Live-quote probe (Engineering window, 2026-11-13, IC Markets demo, connected)
The cost-from-spread input (InpCost 0) gave sensible values on live quotes (spreads: XAUUSD 0.15, EURUSD 0.0001, US500 0.5, BTCUSD 5.0). Alert and push firing once per bar still needs a real setup / touch / divergence to occur and is NOT yet verified.
