# Crypto indicators - R&D memo (2026-11-11, price-only, MT4/MT5 BTCUSD)

Owner brief: focus on indicator development; BTCUSD exists on all MT4/MT5 brokers. MT4/MT5 indicators cannot use external data (no WebRequest in MT4 indicators, MT5 needs URL whitelisting), so everything below is **price-only** and runs on any broker's BTCUSD.

## What the data says (Lab C2, `ea-research/indicators/_lab/reports/LAB-C2-BTC-STRUCTURE-REPORT.md`)
- Strong, stable, price-only structure: range peaks at 13-16 UTC (14:00 UTC median H1 range 0.87 % vs 0.38 % at 04:00); weekends are about half as wide as weekdays since 2023 (ratio 0.77 -> 0.55); funding hours (00/08/16 UTC) carry a small range bump (+7 to +22 %, shrinking). Volatility now 36 % annualised = 16th percentile of its history (calm). Drawdown from ATH -41.5 %; BTC spends 75 % of the time >10 % below its ATH.
- No edge anywhere (Labs C1, 01-06): the indicators must describe movement and risk, never direction.

## Candidates, ranked (all MT5 first; MT4/TradingView ports stay with the Engineering window)
1. **AT24 Crypto Session Clock** (UTC, 24/7): 24-hour range profile with weekday/weekend split, the current hour rated against its usual range, funding hours marked. Same verified family as Cost Clock / Expected Range, but no New York clock and no daily break. Proven stable by C2. Highest value, lowest risk.
2. **AT24 Drawdown Depth Map**: distance from the all-time high (on the broker history), days since ATH, how deep and how long past drawdowns were, share of time below -10 / -30 %. Honest crypto context ("-40 % is normal") instead of hype.
3. **AT24 Crypto Vol Regime**: 30-day realised volatility (annualised with 24/7 bars) and its percentile versus the symbol's own history; calm / normal / hot. States clearly that volatility is persistent and mean-reverting, nothing about direction. (Check overlap with Volatility Forecast; adapt instead of duplicating if it fits.)
4. **AT24 Correlation Map**: rolling 30-day correlation of BTCUSD daily returns with ETHUSD, XAUUSD, a US index and EURUSD from the same broker (symbol names as inputs), with the percentile versus its own history ("is BTC trading like a risk asset now?"). Needs other symbols present; unique among our tools.
5. **Compatibility audit of the existing suite on BTCUSD**: History Doctor, Edge Truth Test, Position Size (contract specs differ per broker), Cost Clock (uses the New York clock; needs a 24/7 mode), Round Levels (step must scale: 1,000 / 5,000), Weekend Gap Tracker (meaningless where the broker is 24/7), ServerClock detection (fails on 24/7 symbols; the FX-pair fallback and manual override exist). Produces a "Crypto Pack" table of what works as is.
6. **Not recommended:** halving-cycle clock (only 3 cycles, pseudo-science risk), on-chain / whale / funding / OI indicators on MT4/MT5 (no data feed there; those belong on the website, see `docs/CRYPTO-RD-2026-11-11.md`), any buy/sell signal.

## Test setup
The portable MT5 is offline and has no BTC history cached (Equiti symbol BTCUSD.lv exists but cannot be downloaded offline). Plan: import Binance BTCUSDT H1 (63,051 bars from 2019-09, already downloaded to the portable MQL5\Files\btc_h1.csv, not committed) into a clearly labelled custom symbol, and verify each indicator against an independent Python calculation as usual; a real-broker BTCUSD check is then done by the Engineering window on a connected terminal (as with the Edge Truth Test).

## Recommended order
1 Crypto Session Clock -> 2 Drawdown Depth Map -> 3 Crypto Vol Regime -> 4 Correlation Map -> 5 compatibility table. Each: core + SelfTest + Python verify + screenshot + test record + brief + handover row + PR + merge + message to the Engineering window.
