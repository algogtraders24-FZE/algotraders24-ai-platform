# AT24 Trend Pullback Map - marketing brief (list item #3)

**Name:** AT24 Trend Pullback Map  **Tagline:** Is it a trend - and how do pullbacks really end?
**Platforms:** MT5, MT4, TradingView. **Type:** context indicator, no signals. Strategy lesson: #3 EMA Trend Pullback.
**Assets:** `ea-research/indicators/AT24_Trend_Pullback_Map/branding/` (logo, banner, screenshot_mt5.png, screenshot_tradingview.jpg). Own logo (EMA ribbon + pullback arrow).

## What it solves
"Buy the pullback to the 20/50 EMA" is the most repeated trading advice, yet few traders know how pullbacks end on their own symbol. The indicator draws the EMA ribbon, classifies the market as uptrend / downtrend / range, tells you where price is (running, extended, in the pullback zone, deeper than the zone, trend broken) and measures real history: how often a pullback to the fast EMA resumed the trend (new swing extreme) versus failed (close past the 50 EMA), the median depth in ATR and how long it took.

## Features
EMA 20/50/200 ribbon (inputs), mid-EMA trend colour, pullback touch arrows, state and zone on the dashboard, price distance from the fast EMA in ATR, pullback statistics, alert on a new touch (bar close, no repaint), branded dashboard (off in the Strategy Tester by default).

## Honest claims you MAY make
- Real history on your own broker data. Our XAUUSD M15 test (438 touches): trend resumed 39.5%, failed 55.5%, neither 5.0%, median depth 3.0 ATR.
- Maths verified against an independent Python calculation (EMA/ATR 5e-6, trend 0 mismatches, 438 events identical); MT4 runtime buffers match over 400 bars; TradingView compiles and renders.
- It never prints buy/sell arrows: the triangles only mark where price touched the fast EMA in a trend.

## Claims you must NOT make
- No "pullback strategy that works", win rates or edge: on this data pullbacks failed more often than they resumed, and our earlier 25-rule scan found no cost-adjusted edge for EMA pullbacks.
- "Resumed" and "failed" are defined on the dashboard; other definitions give other numbers. Past behaviour does not predict.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
