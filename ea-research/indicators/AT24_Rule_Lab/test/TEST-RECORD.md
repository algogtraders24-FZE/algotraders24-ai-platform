# AT24 Rule Lab - test record (2026-11-18)

## Engine checks
| Check | Result |
|---|---|
| MT5 compile | indicator, core, self test, unit test, shot: 0 errors, 0 warnings |
| Hand-worked unit tests (`AT24_RL_UnitTest.mq5`) | 23 passed, 0 failed: weighted moving average; on a straight line up KAMA long, FRAMA silent (D = 1, alpha = 1, FRAMA = close), HMA long (HMA = close - 1/3), Vortex long (VI+ 2.0 vs VI- 0), Squeeze none; mirror on a line down; flat market: all six silent; Squeeze release long (mom +1.45) and short (mom -1.45) with no signal the bar before or after; trades on a line (6 per rule, R = (24 - 0.5) / 2 = 11.75), a 0.1 ATR stop stops every trade (R -0.35), `from`, too-short history |
| Independent Python (`verify_rl.py`, pandas / numpy re-implementation of SPEC.md) on 5 symbols x 20,000 H1 bars, stop 0 and stop 2 ATR | signals of all six rules, states, 45,000+ trades, per-cell n, class, stopped count, average, hit rate and luck-test p identical (max difference 5e-11), 10 of 10 runs |
| No look-ahead (cut-history test) | EURUSD and XAUUSD, 3 cuts each: 0 differing signals |
| Real chart (MT5, XAUUSD H1, iCustom) | six rule chips, 6 x 5 grid, analog block render; the grid and chips read back identical: test/mt5_rule_lab_chart.png |

## R&D that decided the design
`rnd_rule_lab.py`, `rnd_rule_lab_result.json` and SPEC section 1: out of sample on 13 symbols the six rules are mostly negative after costs, every rule is worst in NOISY markets; clearest positive cells HMA in STRONG MOVE (+0.082, 8 of 12 symbols) and SQUEEZE in COMPRESSED (+0.045, 7 of 13).

## Bugs and decisions found while verifying (both would have made two correct implementations disagree)
1. Vortex: VI+ and VI- are equal in exact arithmetic when bars overlap (the sums telescope), so the sign depended on the summation order (5 bars of 100,000 differed). The rule now uses a 1e-12 tolerance and a tie is no signal.
2. Stop hit test: a stop price can equal a bar extreme up to rounding (price grid x ATR multiples). Both the MT5 core and the Python check now treat a stop price within 1e-12 (relative) of the bar's high / low as hit. The same tolerance was added to `AT24_SF_Core.mqh` (Strategy Fit; its 31 unit tests and the 10-run Python check were repeated and pass) and to the copy in AT24_Analog_Finder.

## Honest limits
- Cells with few trades prove nothing (n shown); with 30 cells some FIT cells appear by chance. The measured trade includes the stop shown on the panel; spread is the current spread for all past trades; swap is not included.
- The analog block uses the Analog Finder rules (12,000 bars by default) and says "direction NOT RELIABLE" unless the symbol's own self-test passes.
- Not verified live: alerts and push, other brokers, forward record. No signal service, no trade, no profit claim.
