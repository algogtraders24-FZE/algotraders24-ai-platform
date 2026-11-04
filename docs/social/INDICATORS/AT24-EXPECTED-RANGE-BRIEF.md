# AT24 Expected Range - marketing brief (list item #5)

**Name:** AT24 Expected Range  **Tagline:** How much of today's usual range is already gone?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals. Strategy lesson: #5 ATR expected-range.
**Assets:** `ea-research/indicators/AT24_Expected_Range/branding/` (logo, screenshot_mt5.png).

## What it solves
Traders place targets and stops without knowing whether the day is already stretched. The indicator takes the average range of the previous 14 complete days, shows the day open, the projected day high (today's low + usual range) and low (today's high - usual range), and a state: QUIET / NORMAL / STRETCHED / EXTREME by percent of the usual range used. It also measures on YOUR symbol how often days really exceeded that range.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (72 days): median day used 89 % of the usual range; 38 % of days exceeded 100 %, 10 % exceeded 150 %; of days that reached 100 %, 41 % finished at 125 % or more.
- Maths verified against an independent Python calculation (all days and statistics identical). No look-ahead: today's expectation uses only previous complete days.
- Never prints buy/sell arrows.

## Claims you must NOT make
- No "price stops at the expected range", "fade the stretched day" or any edge: reaching 100 % is not a ceiling.
- Server-time days: results depend on the broker's day boundary; daily range only (no 12-hour window).

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
