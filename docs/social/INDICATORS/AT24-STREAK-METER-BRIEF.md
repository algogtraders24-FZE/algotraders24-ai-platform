# AT24 Streak Meter - marketing brief (new indicator)

**Name:** AT24 Streak Meter  **Tagline:** "Three red days in a row, a green one is due" - is it?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Streak_Meter/branding/` (logo, screenshot_mt5.png).

## What it solves
The gambler's-fallacy style rule "after N down candles a reversal is due" (or "the streak will continue") is everywhere. The indicator counts the current same-colour candle streak on the timeframe you choose (default daily) and shows, on YOUR symbol, how often the next candle had the same colour after streaks of 1, 2, 3, 4, 5 and 6+ candles, with sample sizes, 95 % intervals and the any-candle baseline.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD daily candles (953): the next candle had the same colour 46-47 % of the time after streaks of 1 to 4 candles (baseline 46.6 %): no streak-length effect, and no "due for a reversal" effect. H4 candles (5,719) were around 50 % throughout.
- Counts and percentages verified against an independent Python calculation (D1 and H4 tables identical).
- Shows sample sizes so users see why long-streak numbers are noise.

## Claims you must NOT make
- No "fade the streak" or "ride the streak" signal, no edge or win rate: all rates are within noise of the baseline.
- Results depend on the symbol, timeframe and the broker's candle boundaries.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
