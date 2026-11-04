# AT24 News Risk Clock - marketing brief (list item #11)

**Name:** AT24 News Risk Clock  **Tagline:** Know when the news lands - and how big the move usually is.
**Platforms:** MT5 only for now (live terminal; not available in the Strategy Tester). **Type:** context indicator, no signals. Strategy lesson: #11 News-event filter.
**Assets:** `ea-research/indicators/AT24_News_Risk_Clock/branding/` (logo, screenshot_mt5.png).

## What it solves
Traders get caught holding through high-impact news. The indicator reads MetaTrader's built-in economic calendar, shows a countdown to the next high-impact events (USD by default, any currencies you list), a risk-window state (CLEAR / NEWS SOON / RISK WINDOW / JUST RELEASED), event lines on the chart, and measures on YOUR symbol how much bigger the price range was in the 30 minutes after such news than at the same clock time on quiet days.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (159 high-impact USD releases): the 30-minute range after a release was a median 1.4x a quiet day's range at the same time; 47 % of releases gave 1.5x or more, 34 % gave 2x or more, 24 % were quieter than normal.
- Maths verified against an independent Python calculation (all 159 events and statistics identical). Uses the terminal's own calendar: no extra accounts or web requests.
- Never prints buy/sell arrows.

## Claims you must NOT make
- No direction: the statistic is the SIZE of the move, not up or down. No "trade the news" edge or win rate.
- Calendar data come from the terminal (MetaQuotes) and can be late or revised; it is not a guarantee that no news is missed.
- Does not work in the Strategy Tester.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
