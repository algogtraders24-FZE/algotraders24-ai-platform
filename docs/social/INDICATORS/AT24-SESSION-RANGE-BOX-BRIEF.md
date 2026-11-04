# AT24 Session Range Box - marketing brief (list item #1)

**Name:** AT24 Session Range Box  **Tagline:** The Asian range, drawn - and what it really did on your symbol.
**Platforms:** MT5, MT4, TradingView. **Type:** context indicator, no signals. Strategy lesson: #1 Asian Range Breakout (ADVANCED-TRADER-GOLD-STRATEGY-LIST.md).
**Assets:** `ea-research/indicators/AT24_Session_Range_Box/branding/` (logo, banner, screenshot_mt5.png, screenshot_tradingview.jpg). Own logo (box with breakout arrow).

## What it solves
Traders hear "trade the Asian range breakout" but never see how often it works on THEIR broker and symbol. The indicator draws the Asia box every day, shows live state (inside / broke up / broke down / failed), and measures the last 60 days: how often the first break was up, down or none, how often a break held to the day end, how often it ran at least 1x the box, and today's box size versus the median.

## Features
Daily Asia boxes + dotted extension boxes coloured by state; state label; box size vs median; countdown to London open; real-history statistics panel; alert on the first break (bar close, no repaint); GMT session hours and offset configurable; branded dashboard (off in the Strategy Tester by default).

## Honest claims you MAY make
- Measures real history on your own broker data (our test on XAUUSD M15, 60 days: first break up 38%, down 50%, none 12%; held to day end 54%; ran 1x the box 32% (DST-aware clock)).
- Maths verified against an independent Python calculation (0 mismatches over 43 days) on MT5; MT4 runtime values match; TradingView compiles and renders.
- It never prints buy/sell arrows.

## Claims you must NOT make
- No "breakout strategy that works", win rates, or edge: our own numbers show a coin flip (held 54%) and our earlier 25-rule scan found no cost-adjusted edge.
- Statistics are historical and descriptive; past behaviour does not predict.
- Server-to-GMT conversion can be one hour off across daylight-saving changes.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
