# AT24 Liquidity Levels - marketing brief (list item #2)

**Name:** AT24 Liquidity Levels  **Tagline:** Where the stops sit - and what happened after.
**Platforms:** MT5, MT4, TradingView. **Type:** context indicator, no signals. Strategy lesson: #2 Previous-Day High/Low Sweep.
**Assets:** `ea-research/indicators/AT24_Liquidity_Levels/branding/` (logo, banner, screenshot_mt5.png, screenshot_tradingview.jpg). Own logo (levels + wick sweep).

## What it solves
Everyone talks about "liquidity above yesterday's high" but nobody shows how often a level is swept and what the day did next. The indicator draws previous day / week / month high and low, marks each as untouched, swept (traded beyond) or accepted (closed beyond), and measures the last 60 days on your own symbol: how often PDH / PDL were swept, and after a sweep how often the day closed back inside versus accepted beyond.

## Features
Six level rays with live state labels; dashboard with distance of price to each level; sweep statistics; alert when a day level is swept (bar close, no repaint); GMT day boundaries; branded dashboard (off in the tester by default).

## Honest claims you MAY make
- Real history on your own broker data (our XAUUSD M15 test, 60 days: PDH swept 41%, PDL 57%, either 77%; after a sweep the day closed back inside 58% and accepted beyond 42%, 52 sweeps).
- Maths verified against an independent Python calculation (89 day/week/month periods, 0 mismatches); MT4 runtime values match; TradingView compiles and renders.
- It never prints buy/sell arrows.

## Claims you must NOT make
- No "reversal after a sweep works", win rates or edge: 58% is a small sample with wide uncertainty and is not a tested strategy; our earlier 25-rule scan found no cost-adjusted edge (it included a previous-day sweep rule).
- TradingView day boundaries follow the symbol's exchange session and differ slightly from MT4/MT5 (GMT days).

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
