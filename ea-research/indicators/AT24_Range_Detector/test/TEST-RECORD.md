# AT24 Range Detector - test record (2026-11-03, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 core maths vs independent Python (`mt5/AT24_Range_SelfTest.mq5`, 8,000 XAUUSD M15 bars, ADX 14, slope 2, 2 declines, peak >= 25) | ADX and ATR max diff 5e-6; all 153 ranges identical (start, end, high, low, how it ended, prior move, false-breakout flag, height in ATR); statistics identical (up 51.634%, down 48.366%, breakout with the prior move 47.059%, fell back inside within 5 bars 45.752%) |
| MT5 live chart (portable terminal, XAUUSD M15) | range boxes coloured by how they ended + dashboard with logo and statistics: test/mt5_range_detector_chart.png |
| MT4 / TradingView | not built (owner decision 2026-11-03: MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, 153 finished ranges)
Median range 19 bars and 2.9 ATR tall. Ended up 51.6%, down 48.4% (none ended by strength rising because that option is off). A breakout went the way of the move before the range only 47.1% of the time (a coin flip, slightly towards reversal), and 45.8% of breakouts closed back inside the box within 5 bars (false breakouts). Descriptive only: no edge.

## R&D basis
Concept from the MQL5 Code Base indicator "ADX Auto Range" (code 78836, 2026-10-25): ranges are opened when trend strength (ADX) has been fading from a strong trend and closed on a breakout close or on ADX rising. This is an independent re-implementation (own code); the statistics layer (how ranges end, prior-move match, false breakouts) is new.

## Notes / limits
- A range opens only after ADX was >= 25 recently and fell 2 readings in a row; other settings give other ranges and numbers.
- "Prior move" = close at the box start versus the close 20 bars earlier.
- Statistics use closed bars only; no repaint. Alerts and the live dashboard were not exercised beyond a screenshot.
