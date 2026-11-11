# Indicator market R&D - what users actually buy (2026-11-11)

Owner feedback: context tools (Session Clock, Drawdown Map, Vol Regime) are of no use to users. This memo looks at what sells and what we can build that is strategy based AND honest.

## Evidence: MQL5 Market, indicators sorted by popularity (page read 2026-11-11, first 30 cards; the sort metric is not stated on the page, ratings are not sales)
- **Entry / signal systems dominate** (about 20 of 30): Trend Sniper X (99 USD, 4.86/44), Reversion King (69, 4.94/18, TP1-TP3 + Telegram), Smart Trend Trading System (69, 4.79/**226**), M5 Sniper, SuperScalp Pro, Gann Made Easy (145), M1 Sniper, Atomic Analyst (49, 4.5/64). All show buy/sell arrows with SL and TP levels.
- **Gold-specific signal tools** appear four times (Zoryk Gold, Gold Trend Coach, Gold Entry Sniper, GoldenX): XAUUSD is the favourite symbol.
- **SMC / order-block suites** are the second large group (6 of 30) and several are FREE (SMC Analytics 4.98/53, SMC Nexus, SMC Buy Sell KPG): SMC is commoditised, it is a poor place to compete on price.
- **Trade planner / risk**: Entry Points Pro (199 USD, 4.52/152) shows entry, stop and lot size from deposit and risk before ordering: strong evidence that a trade-planning tool sells.
- **Multi-timeframe dashboards** are bundled into signal tools (Gold Trend Coach, Gold Entry Sniper); standalone scanners are rarer (Trend Screener Pro 4.84/100, FX Power MT5 NG 5/29 appear in searches).
- No news, currency-strength or prop-firm tool in the first 30 (they exist further down). TradingView picture (vendor guides, weak evidence): Squeeze Momentum, Supertrend, WaveTrend, MTF MACD, and SMC/ICT tools with "non-repainting" and "AI scoring" as the marketing words.
- Price band for working signal tools: 30-150 USD; sellers' claims (pips, win rates) are self-reported and unverified.

## What this means for AT24
Users buy **setups with levels** (entry, SL, TP), usually on gold, usually multi-timeframe, plus planning tools. Our research says no setup has a proven edge, so the honest differentiator is the one nobody else has: **every setup is shown together with its own scorecard on the user's own chart history (count, hit rate, average R after costs, an Edge Truth Test verdict, "not validated" when it is not)**, non-repainting (closed bars only), no promises. Sweep Scorecard already works this way.

## Candidates (all MT5 first, price-only, strategy based)
1. **AT24 Setup Pro (flagship)**: trend-pullback / squeeze-breakout / reversion setups on the chart with entry, SL, TP levels (ATR based, shown before the trade), a multi-timeframe alignment panel (M15..D1), alerts (sound / push), and a live scorecard per setup type and per symbol (n, hit %, average R after cost, Edge Truth verdict). Built from cores we already verified (Trend Pullback Map, Squeeze Meter, Sweep Scorecard, TT core). Works on XAUUSD and BTCUSD alike.
2. **AT24 Trade Planner**: draggable entry / SL / TP lines on the chart that return lots, risk %, R:R, margin and a prop-firm daily-loss check; one-click copy of the numbers. Direct answer to the Entry Points Pro demand; builds on Position Size and Prop Guardian.
3. **AT24 Gold Setup Scanner**: the same setup engine on a watchlist (XAUUSD first, then majors and BTCUSD) with a one-panel table and alerts (answers the scanner gap; gold is where the demand is).
4. Later: supply/demand zones with touch counts and scorecard (differentiated from the free SMC suites by the scorecard), RSI/MACD divergence scanner.
Dropped from the earlier crypto plan: Session Clock, Drawdown Depth Map, Vol Regime (context only; Correlation Map stays optional). They can still be folded into Setup Pro as small panels (e.g. "weekend: expect half the usual range" as a warning line), not sold on their own.

## Risks / rules
- Honest labelling: no win-rate or profit promises, "BACKTEST" only with report and settings, "Not financial advice", no fake Trust State (owner rules).
- No logic in listing copy (generic wording only), listing first sentence 70-155 characters, MT4/MT5/TV twins differ (shared quality rules of 2026-11-11).
- Non-repainting by construction (closed-bar logic) is itself a selling point; keep it and prove it with the self-test.
- We have no edge: a setup indicator can legitimately show levels and statistics, but must not imply that the setups are profitable going forward.

## Recommendation
Build **AT24 Setup Pro** first (the engine + scorecard is the moat), then **Trade Planner** (fast, proven demand), then the watchlist scanner. First step: define the setup definitions and the scorecard method in a short spec and verify the engine against Python as usual.
