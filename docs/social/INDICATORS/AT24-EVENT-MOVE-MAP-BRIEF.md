# AT24 Event Move Map - marketing brief (own product)

**Name:** AT24 Event Move Map  **Tagline:** What do CPI, payrolls and the Fed usually do to your symbol? Typical size, not guesses.
**Platforms:** MT5 only (built-in economic calendar API). **Type:** event-risk context; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Event_Move_Map/branding/` (logo; DO NOT use the current screenshot: retake it on a connected terminal, see the test record).

## What it solves
In a market driven by rate-hike bets and inflation data, the releases decide the day. The Event Move Map measures, from the terminal's own calendar history and price bars, how far the chart symbol moved in the hour after every past release type (average move, average range, range versus a normal hour) and shows the same numbers next to the releases coming up, with a countdown and an optional alert before a release.

## Honest claims you MAY make
- It shows the typical SIZE of the reaction on the user's own symbol and broker data; the measurement is verified against an independent Python calculation on 819 releases.
- Size only, not direction: moves go both ways.

## Claims you must NOT make
- No profit, win-rate or "trade the news" wording; no prediction of direction; past reactions do not predict future ones; thin samples are marked.
- Clock handling and the upcoming list are not yet verified on a connected terminal (see the test record).

## Footer text
"Descriptive event-risk tool, not a signal or a forecast. No trades are placed. Not financial advice. algotraders24.ai"
