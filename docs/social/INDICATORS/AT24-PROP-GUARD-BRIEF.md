# AT24 Prop Guard - marketing brief (indicator #3)

**Name:** AT24 Prop Guard  **Tagline:** Know your room before you hit the limit.
**Platforms:** MT5, MT4 (live account dashboard), TradingView (risk-budget calculator edition). **Type:** risk dashboard, not a signal tool.
**Assets:** `ea-research/indicators/AT24_Prop_Guard/branding/` (logo_400.png, logo_200.png, banner_1200x630.png, screenshot_mt5.png, screenshot_tradingview.jpg). Own gauge logo.
**Source:** `ea-research/indicators/AT24_Prop_Guard/{mt5,mt4,tradingview}`

## What it shows (MT5 / MT4)
- Status: WITHIN LIMITS / CAUTION (50%) / DANGER (80%) / LIMIT REACHED
- Daily loss used (% and money) with a gauge; Total loss used with a gauge
- Money left today and left overall; which limit is binding
- Open risk if every stop loss is hit, and how many trades have no stop
- Profit-target progress
- Day start value and the reset hour you choose
- Optional alerts at 80% and 95% of a limit; fully branded dashboard; off in the Strategy Tester by default

## TradingView edition
Cannot read your account. You type account size, limits and the loss already used; it shows limits left, risk per trade in money, how many full losses fit before the limit, stop distance (ATR-based or manual) and the position size for that risk, with stop-distance lines on the chart.

## Honest claims you MAY make
- Numbers verified against an independent calculation on live demo accounts (MT5 22/22 checks, MT4 6/6 checks); TradingView compiles and renders.
- It shows what YOU configured: you set the daily loss %, max loss %, target % and the day-reset hour to match your challenge or account.
- Trending topic: prop-firm guards and drawdown analytics are among the fastest-growing indicator topics in our 2026 research feed.

## Claims you must NOT make
- No "prevents breaches", "guarantees", "passes the challenge" or "works with FTMO/any firm". It is a display tool; it never closes trades.
- Do not name or imply affiliation with any prop firm. Firm rules differ (daily-loss base, reset time zone, trailing rules): users must set them.
- Open risk with live positions is not yet covered by a test (only the no-position case was verified).

## Mandatory footer text
"Context tool, not a guarantee. Rules differ by firm; set your own limits. Not affiliated with any prop firm. Not financial advice. algotraders24.ai"
