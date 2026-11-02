# AT24 Regime Pulse - marketing brief (indicator #1)

**Name:** AT24 Regime Pulse  **Tagline:** Know WHEN to trade, not just where.
**Platforms:** MT5, MT4, TradingView (Pine v5). **Type:** context indicator (no buy/sell signals).
**Assets:** `ea-research/indicators/AT24_Regime_Pulse/branding/` (logo_400.png, logo_200.png, banner_1200x630.png). Logo = official AT24 infinity mark.
**Source:** `ea-research/indicators/AT24_Regime_Pulse/{mt5,mt4,tradingview}`

## What it shows (one panel, one sub-window)
- Regime label: TREND, STRONG TREND, RANGE, CHOP (volatile range), QUIET, MIXED (colour-coded histogram)
- Trend quality: Kaufman Efficiency Ratio (net move / path travelled, 0-1)
- Volatility rank: where today's ATR sits versus the last 500 bars (0-100)
- Spread / ATR cost ratio with a HIGH COST warning
- Session (GMT): Asia / London / London-NY overlap / New York / Rollover
- Optional alert when the regime changes (bar close only, no repaint)
- Own branded dashboard with logo; any corner; switch off in the tester by default

## Honest claims you MAY make
- Core maths verified: the MT5 calculation matches an independent Python recomputation on 4,000 real XAUUSD M5 bars (differences only from rounding).
- Compiles with 0 errors on MT5 and MT4.
- Bar-close logic, no repaint of closed bars.
- Real data fact (XAUUSD M5, 2025-26, ~54k bars): spread cost is about 6% of ATR in strong-trend bars and about 13% in QUIET bars, so QUIET periods cost the most to trade.

## Claims you must NOT make
- No "predicts", "signals", "profitable", "win rate" or "edge". Our own check found the regimes do NOT persist: the Efficiency Ratio of the next 20 bars was about 0.21-0.24 in every regime. It describes the CURRENT state; it does not forecast.
- Verified on a live MT5 chart (XAUUSD M5): dashboard, logo, coloured histogram, rank line. Screenshot: `ea-research/indicators/AT24_Regime_Pulse/branding/screenshot_mt5.png`. Full test record: `.../test/TEST-RECORD.md`.
- Also verified: MT4 (values read through iCustom match an independent Python calculation) and TradingView (compiles and renders in the Pine editor; screenshot `branding/screenshot_tradingview.jpg`).

## Mandatory footer text
"Context tool. Not a signal. Past conditions do not predict future results. Not financial advice. algotraders24.ai"

## Install (MT5/MT4)
Copy the .mq5/.mq4, the .mqh and logo56.bmp into the same folder under MQL5\Indicators (or MQL4\Indicators), compile in MetaEditor, drag onto any chart. TradingView: paste the .pine into the Pine editor and Add to chart.
