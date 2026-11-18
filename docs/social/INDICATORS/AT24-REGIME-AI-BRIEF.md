# AT24 Regime AI - brief

Every closed H1 bar is put into one of 5 learned market states: NOISY, WIDE SWING, STRONG MOVE, COMPRESSED, STEADY TREND. The dashboard shows the current state, how long it has lasted, how often a state stays on the next bar, and what each state of this symbol was followed by: the size of the next 24 hours compared with average, with the number of bars behind it.

- Learned once, offline (k-means on 12 symbols, fixed constants). No learning on your chart, no repaint, a closed bar's state never changes.
- Out-of-sample research (last 40 % of history, 13 symbols incl. gold, forex majors, indices and Bitcoin): two states are followed by a smaller than average next 24 h range on all 13 symbols, two by a larger one on all 13, one on 12 of 13.
- It is about the size of moves, not direction. No buy or sell signal, no profit claim.
- Colour strip of states in a sub-window, optional alert on a state change, buffers for EAs (state, run length, ratio).
- Input: history bars for the own statistics, alert, dashboard. H1 charts (other timeframes show a notice).
- Platform: MT5. Price: 33 USD (series standard).
- Test status: 31 unit tests, independent Python check identical, no look-ahead test passed; alerts and live forward record not verified yet.

## v1.10
- New 3D-style dashboard (bevelled panels, big state name, range columns per state).
- Weekly bias from the verified Position Map rules: trend UP / DOWN / RANGE, stage, entry / stop / TP1 and the 1:3 record with n. Buy / sell arrows on the chart at each plan's entry, lines for the running plan, optional trigger alert.
- Direction is the weekly-structure rule set, not a forecast; the state is about the size of moves.
