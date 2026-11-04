# AT24 Auto Fib Zones - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| MT5 core maths vs independent Python (`mt5/AT24_Fib_SelfTest.mq5` + `test/verify_fib.py`, 8,000 XAUUSD M15 bars, swing = 5 bars each side) | 785 swings identical (bar, confirmation bar, price, direction); 782 legs and every statistic identical (median depth 0.9697, reached 38.2 / 50 / 61.8 = 91.4 / 82.7 / 75.1 %, past 100 % 48.5 %, resumed 48.3 %, shallow-then-resumed 65.6 % of 195) |
| Control (`test/fib_control.py`) | share of pullbacks ending within +-2.5 % of 50 % / 61.8 % = 3.70 / 3.96 %, other (non-fib) bands average 3.29 % (2.94-4.21): no clustering at fib levels |
| MT5 live chart (portable terminal, XAUUSD M15) | fib lines + shaded 38.2-61.8 zone + labels + dashboard with logo: test/mt5_auto_fib_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, 782 legs)
Pullbacks after a 5-bar swing leg took back a median 97 % of the leg; 48.5 % went past 100 %, and only 48.3 % of legs resumed beyond their extreme (a coin flip). Pullback depths do NOT cluster at 38.2 / 50 / 61.8 more than at other values. Descriptive only: no edge. The "shallow then resumed 66 %" line is partly circular (a shallow pullback leaves less room to fail) and must not be sold as an edge.

## R&D basis
MQL5 feed 2026-11: ICT dealing-range / premium-discount from confirmed swings (post 4606), swing engine (4521), market-structure quantification (4539). Own code: strict k-bar fractal swings, alternating, same-side swings merged to the more extreme; swing known only k bars later.

## Notes / limits
- Swings are confirmed (closed bars, k bars delay); levels never repaint, but the "last leg" can change when a new swing confirms.
- A pullback past 100 % means the leg was superseded; the dashboard then shows the depth above 100 %.
- Alerts and dashboard corner options were not exercised beyond the screenshot.
