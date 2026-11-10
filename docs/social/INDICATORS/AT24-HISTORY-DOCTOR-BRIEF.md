# AT24 History Doctor - marketing brief (own research product)

**Name:** AT24 History Doctor  **Tagline:** Is your backtest data even real? Check before you trust a number.
**Platforms:** MT5 only for now. **Type:** data audit tool; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_History_Doctor/branding/` (logo, screenshot_mt5.png).

## What it solves
Most backtests and "statistics" are run on whatever history the broker feed happens to hold. Years can be stored as two bars per day, the spread field can be empty for years, bars can be broken or hours missing. Every result built on that is noise dressed as evidence. History Doctor gives one verdict and a year-by-year table so you know from which date your data deserves trust.

## Honest claims you MAY make
- It audits the user's own terminal history of the chart symbol: first real hourly day, spread coverage per year, broken bars, missing hours.
- On our XAUUSD test feed it found hourly data usable only from May 2021 and the spread field empty on most bars until 2024; this is exactly what invalidated our own first research runs.
- The engine is verified against an independent Python calculation, including a deliberately corrupted copy of the data (all faults found).

## Claims you must NOT make
- It does not prove prices are correct or the broker is honest; it checks completeness and internal consistency only.
- No profit, edge or win-rate claims. It is not a signal.

## Footer text
"Audit of the data your terminal holds. Research tool, not a signal or a forecast. No trades are placed. Not financial advice. algotraders24.ai"
