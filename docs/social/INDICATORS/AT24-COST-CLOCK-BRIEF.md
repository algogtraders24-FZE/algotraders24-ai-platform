# AT24 Cost Clock - marketing brief (own research product)

**Name:** AT24 Cost Clock  **Tagline:** What does a trade cost right now, compared with how far price usually moves in this hour?
**Platforms:** MT5 only for now (H1 history with a filled spread field, DST-aware New York clock). **Type:** cost context; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Cost_Clock/branding/` (logo, screenshot_mt5.png).

## What it solves
The same spread is a rounding error in the New York morning and a real cost in the quiet hour before the close. The Cost Clock shows spread as a share of the typical hourly range for all 24 New York hours, marks the current hour, and lists the cheapest and costliest hours on the user's own broker data.

## Honest claims you MAY make
- It measures cost relative to typical movement per hour on the user's own feed; on our XAUUSD test feed the cheapest hours were the NY morning (about 0.6 % of the typical hour range) and the costliest the last hour before the daily break (about 1.8 %).
- The ranking was stable between 2025 and 2026 in our research (Lab 04), and the engine matches an independent Python calculation on all 24 hours.

## Claims you must NOT make
- No "trade in cheap hours to win": a cheap hour only costs less per unit of movement; the spread itself is nearly flat, the ranking mostly reflects volatility.
- Bar-level spread only; live widening is not fully captured. No profit or win-rate claims.

## Footer text
"Descriptive history on your broker's data. Research tool, not a signal or a forecast. No trades are placed. Not financial advice. algotraders24.ai"
