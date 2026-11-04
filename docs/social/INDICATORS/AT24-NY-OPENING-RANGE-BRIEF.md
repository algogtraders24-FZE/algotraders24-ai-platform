# AT24 NY Opening Range - marketing brief (list item #7)

**Name:** AT24 NY Opening Range  **Tagline:** The first 30 minutes of New York - and what really followed.
**Platforms:** MT5 only for now (M30 or lower chart). **Type:** context indicator, no signals. Strategy lesson: #7 New York opening range.
**Assets:** `ea-research/indicators/AT24_NY_Opening_Range/branding/` (logo, screenshot_mt5.png).

## What it solves
Opening-range advice ignores that the New York open moves against broker time twice a year. The indicator draws the 09:30-10:00 New York range on the right broker-clock hour all year (daylight-saving aware, checked against the standard time-zone database), shows if the range is forming, set or broken, the time left, and measures on YOUR symbol what happened after the break against a control window at 11:00.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (87 days): the range broke up 44 % / down 56 %; the break was still beyond the range at 16:00 on 54 % of days; 56 % of breaks closed back inside within 4 bars. A control window at 11:00 gave about the same numbers.
- Time conversion verified against the standard time-zone database on 8,000 bars; maths verified against an independent Python calculation (all days and statistics identical). No repaint: closed bars only.
- Never prints buy/sell arrows.

## Claims you must NOT make
- No "trade the NY open breakout", "opening range edge" or win rate: it behaves like any other 30-minute window.
- Results depend on the symbol, range length and break rule.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
