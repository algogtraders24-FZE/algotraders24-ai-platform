# AT24 Sweep Scorecard - test record (2026-11-10, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_SW_SelfTest.mq5` + `test/verify_sw.py`, 33,009 valid XAUUSD H1 bars, 2021-05-05 to 2026-11) | all 954 sweeps identical (sweep bar, GMT day, direction, extreme, entry, risk); every reversal and continuation trade result in R identical; all statistics identical for all events and for the latest 250 |
| Consistency with Research Lab 03 | the same 954 events and the same reversal result (-0.2393 R per trade, hit 42.5 %, t -7.5) as the pre-registered lab test S1 |
| History guard / clock | days with fewer than 20 hourly bars are skipped (this broker stores H1 before 2021-05 as two bars per day); GMT hour/day come from the DST-aware server clock |
| MT5 live chart (portable terminal, XAUUSD H1) | scorecard, today's state (range set, watching), Asian boxes and sweep marks coloured by the reversal result: test/mt5_sweep_scorecard_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Definition (stated openly, fixed in the lab before results were seen)
Asian range = high/low of the H1 bars before GMT 07:00 (at least 6 bars). Sweep window = GMT 07:00-12:59 (at least 4 bars). A sweep is the first bar that trades beyond one side of the range and CLOSES back inside (a bar that does both sides ends the search). Reversal trade: enter at the next bar's open against the sweep, stop at the sweep extreme, target 1R (R = distance from entry to the extreme, more than 0.5), exit at GMT 16:00 or after 11 bars, a stop wins a same-bar tie, fixed cost 0.25 per trade (price units, input). The continuation trade is the mirror (same distance, other direction); the control is the average of the two (the expected result of a random direction).

## Real result on one broker feed (XAUUSD H1, 954 sweeps, 2021-05 to 2026-11)
| | per trade, net of cost |
|---|---|
| Reversal | **-0.24 R** (hit 42.5 %, t = -7.5) |
| Continuation | -0.12 R (hit 47.8 %) |
| Random direction (control) | -0.18 R |
| Reversal minus control | -0.06 R (t = -1.9) |
| Latest 250 sweeps (about 14 months) | reversal -0.10 R (t = -1.6), control -0.15 R, reversal minus control +0.05 R (t +0.9) |
Typical 1R is 3.8 USD, so the 0.25 cost alone is 0.07 R; the structure itself (stop wins ties, time exit) costs about another 0.1 R, which is why the control is negative too. Over the whole history the popular reversal setup lost money; over the latest 14 months it is statistically indistinguishable from a random direction (risk per trade has grown to about 8 USD as gold rose).

## Notes / limits
- Definition-specific: other Asian hours, sweep windows, targets, stops or filters may behave differently; none were tested. Cost is a fixed input, not the real spread.
- The scorecard grades what the rule would have done on closed bars; it places no trades and is not a signal.
- Today's state uses closed bars only; the forming hour is never used. Alert (new sweep) not exercised beyond a compile.
