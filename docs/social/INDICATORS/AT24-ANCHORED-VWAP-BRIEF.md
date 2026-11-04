# AT24 Anchored VWAP - marketing brief (list item #8)

**Name:** AT24 Anchored VWAP  **Tagline:** Where did the average trader pay?
**Platforms:** MT5 only for now (MT4 / TradingView to be done by another agent). **Type:** context indicator, no signals. Strategy lesson: #8 VWAP and Anchored VWAP.
**Assets:** `ea-research/indicators/AT24_Anchored_VWAP/branding/` (logo, banner, screenshot_mt5.png). Own logo (VWAP with deviation bands and a price path).

## What it solves
Traders use VWAP as "fair value" but rarely see how price really behaves around it on their own data. The indicator draws day VWAP with +-1/2 SD bands plus week and month VWAP, shows how many SD price is from each, and measures the last days: after a close 2 SD from the day VWAP, how often price came back to the VWAP, how often it went on to 3 SD, and how often price closes above VWAP.

## Honest claims you MAY make
- Real history on your own broker data. Our XAUUSD M15 test (85 days): after a 2 SD stretch, price touched the day VWAP again before the day ended on about 77% of days, extended to 3 SD on 14%, neither 9%; 48% of closes were above day VWAP (DST-aware clock).
- Maths verified against an independent Python calculation (VWAP, SD and the reversion statistics identical).
- It never prints buy/sell arrows.

## Claims you must NOT make
- No "VWAP reversion strategy", "77% win rate" or edge: VWAP drifts toward price during the day (which makes touching it easier), a touch is not a profit, stretches can run first and costs are ignored.
- Volume is tick volume, not real traded volume; say so.

## Footer text
"Descriptive history on your broker's data. Tick volume. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
