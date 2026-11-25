# Day 1: Iron Stops (Market product 190545, XAUUSD M30) - behaviour from a tester run

Setup: licensed Market demo run in the Strategy Tester on the Exness demo terminal, XAUUSD (Exness 24/7 symbol XAUUSD247), M30, 2026-01-01..2026-10-09, 1-minute OHLC (screening only), $10,000, 1:500, default inputs (risk 1%). Observation of outputs only; no code inspected.

## Results
| Metric | Value |
|---|---|
| Net profit | +6,937 (+69% in 9 months) |
| Profit factor / recovery factor | 4.45 / 14.9 |
| Max drawdown | equity 4.47%, balance 1.86% |
| Trades | 75 (about 2 per week) |
| Win rate | 81.3% (long 77.5%, short 85.7%) |
| Avg win / avg loss | +146.7 / -142.3 (payoff about 1.03) |
| Max consecutive losses | 2 |
| Hold | median 4.9 h, mean 9.8 h, 5 trades > 36 h (seller says positions close within 36 h) |

## Behaviour (what the trades show)
- Market entries, one position at a time, long and short about equally (40 buy / 35 sell), Monday-Friday, up to 2 entries per day, 73 trading days out of about 190.
- SL median about 46 USD (range 5-157), TP median about 27 USD: **TP is about half of SL** (median TP/SL 0.5). Exits: 59 TP, 14 SL, 1 other, 1 open at test end. This is the high-hit-rate / low-payoff profile.
- Entry hours are spread over the day (slight cluster 12:00-15:00 server time). Lot size is risk based (0.01-0.19).
- **Bursty activity:** 2-5 trades per month Jan-Jul, then 19 (Aug) and 21 (Sep). The edge, or at least the trade frequency, depends on the volatility regime.
- Seller text: "Volume Acceleration" breakout, XAUUSD only, M30, drawdown protection input. The exact entry trigger is not visible.

## Reading
- Matches the profile of the best live gold signals (hit rate 70-80%, tight drawdown, TP closer than SL) rather than M12's low-hit-rate trend profile.
- Gate check: NOT PASSED yet. Only 75 trades (gate needs >= 300), OHLC model only, one 9-month window dominated by two active months. Reviews on the Market page report live results not matching backtests, and the live signal page (2386516) could not be read, so no live comparison was possible.
- Next cheap test (max 1-2): real-ticks run of the same window, then 2025 H2 on the same terminal to see whether it trades and wins outside Aug-Sep.
