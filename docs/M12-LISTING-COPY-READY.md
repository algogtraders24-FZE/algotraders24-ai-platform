# AT24 Gold Range Breaker - listing description, ready to paste

Replaces the `description` of the live listing `at24-gold-range-breaker` (live Trust Status checked 2026-10-07: INCONCLUSIVE, price USD 299).
Paste it in the seller dashboard listing editor. Nothing else on the listing needs to change.
Sources: listed M2-M5 evidence report (Vantage Markets, MT5 Strategy Tester, 2025.01-2026.08) and its M5 risk analysis.

---

AT24 Gold Range Breaker trades the previous-day high/low breakout on XAUUSD (MT5), confirmed by an EMA trend filter and an ADX strength filter. It adds up to two smaller "pyramid" positions while a trade moves in your favour.

Independently verified backtest evidence (AT24 M2-M5 pipeline, MT5 Strategy Tester, 2025.01-2026.08):
- 1,511 trades, net profit +21,723 on a 10,000 start, profit factor 1.16, win rate 39.9%
- Max balance drawdown 29.0%; equity-based about 34%, lasting roughly 4 months; 39 drawdown episodes
- 7 of 20 months were negative; the worst month lost about 4,360 (on 10,000)
- Walk-forward (train 2025, test 2026, no re-optimization between windows): consistent, not degrading

Settings used in the evidence run (these differ from the EA's default inputs):
- Fixed lot 0.10 on a 10,000 account (not risk-percent sizing); up to 2 initial trades per day
- Stop loss 2.5 x ATR(14), take profit 5 x ATR(14), pyramid add at 0.5R
- Break-even OFF, session time filter OFF; EMA(100) and ADX(14) >= 20 filters ON; M15 chart, Vantage Markets data
Load the same inputs if you want to reproduce these results; the default inputs have not been backtested to the same standard.

What to expect:
- It wins in streaks and gives some back. About 4 in 10 trades win; profit comes from winners being larger than losers. Expect several flat or losing weeks, and occasionally several losing months in a row.
- Size for a 30-35% drawdown, not 10%. If a 30% dip would make you stop the EA, lower the lot size or do not buy.
- Backtests are not live results. They use one broker's data and do not include commission or swap.

Known limits (read before buying):
- Trust Status: INCONCLUSIVE. Market-regime coverage and parameter-sensitivity checks are not yet computable. This is an open check, not a rejection of the strategy.
- Spread was not modelled in the evidence run. Wide spreads (rollover, news) cost more than the backtest shows. Keep the EA's max-spread input on.
- Built for XAUUSD only. Run it on a demo account first.
- Requires your AT24 licence details in the EA inputs; outside the Strategy Tester an unlicensed copy does not trade.

Past performance is not a guarantee of future results. Trading leveraged products can lose more than you invest.

---

Note for the owner: the "Settings used in the evidence run" block is the important honesty fix. The EA's shipped defaults (1% risk sizing, SL 1.5x, TP 3x, break-even on, time filter on, 1 trade/day) are not the configuration the evidence was produced with.
