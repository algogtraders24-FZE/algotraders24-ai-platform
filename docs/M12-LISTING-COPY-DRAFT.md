# AT24 Gold Range Breaker - listing copy draft (for owner review)

Status: DRAFT. Not applied to the live listing or DB. Replaces the description string in
`frontend/scripts/create-pdhpdl-gold-listing.ts` only if the owner approves.
Every number below is either from the listed M2-M5 evidence (cited) or marked as unverified.

## Proposed description

**AT24 Gold Range Breaker** trades the previous-day high/low breakout on XAUUSD (MT5), confirmed by an EMA trend filter and an ADX strength filter. It risks a fixed percentage per trade, adds up to two smaller "pyramid" positions while a trade moves in your favour, and moves the stop to break-even after a 1R gain.

### What the evidence shows (listed M2-M5 verification, MT5 Strategy Tester, 2025-01 to 2026-08)
- 1,511 trades, net profit +21,723 on a 10,000 start, profit factor 1.16, win rate 39.9%.
- Max balance drawdown 29.0% (equity-based analysis: about 34%, lasting roughly 4 months). 39 drawdown episodes.
- 7 of 20 months were negative; the worst month lost about 4,360 (on 10,000).
- Walk-forward (train 2025, test 2026): consistent, not degrading.

### What to expect
- **It wins in streaks and gives some back.** About 4 in 10 trades win; profit comes from winners being larger than losers. Expect several flat or losing weeks, and occasionally several losing months in a row.
- **Size drawdowns for 30-35%, not 10%.** If a 30% dip would make you stop the EA, lower the risk % or do not buy.
- **Backtests are not live results.** They use one broker's data and do not include commission or swap.

### Known limits (read before buying)
- Trust Status is INCONCLUSIVE: market-regime coverage and parameter-sensitivity checks are not yet computable. This is an open check, not a rejection.
- Spread was not modelled in the listed evidence run. Wide spreads (rollover, news) will cost more than the backtest shows. Keep the EA's max-spread input on.
- Built for XAUUSD only. Run it on a demo account first.
- Requires your AT24 licence details in the EA inputs; outside the Strategy Tester an unlicensed copy does not trade.

Past performance is not a guarantee of future results. Trading leveraged products can lose more than you invest.

## Not included on purpose (needs the owner's decision)

**Do not put the 2026-10-07 MT5 real-ticks cross-check numbers into customer copy yet.**
That check (7 windows, 577 trades, +9,375, 5 of 7 windows positive) is not comparable to the listed run:
- Listed evidence: 1,511 trades over the same period. The cross-check produced 577 with the EA's default inputs on M15.
- The listed evidence's exact timeframe and input set are not recorded in the repo (source: an MT5 deals-table export), so the cross-check may have run different settings. The "43% of listed profit" framing used earlier in `docs/MQL5-BOOK-EA-PRODUCTION-RD.md` section 13 is therefore NOT an apples-to-apples comparison and should be read as "same direction, settings unreconciled".
- To make it publishable: find the settings that reproduce 1,511 trades (timeframe, max trades/day, filters), re-run on real ticks, then compare.

## v2.11 vs v2.10
v2.11 (AT24_EA_Core) is trading-identical to v2.10 in the tester (same trades and P&L on 1-minute OHLC and on real ticks). Its benefit is order execution: the fill mode comes from the symbol instead of a hardcoded FOK. Listing it means a new release/version record; decide separately from the copy above.
