# AT24 FVG Zones - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| MT5 core maths vs independent Python (`mt5/AT24_FVG_SelfTest.mq5` + `test/verify_fvg.py`, 8,000 XAUUSD M15 bars, ATR 14, min gap 0.3 ATR, 50-bar window, 20-bar reaction) | all 693 gaps identical (bar, direction, top, bottom, first-touch bar, fill bar); every statistic identical (690 measured, revisited 89.7 %, filled 77.7 %, median wait 2 bars, control 88.6 %, bounced 73.2 % of 619) |
| MT5 live chart (portable terminal, XAUUSD M15) | open gap zones (up green / down red) + dashboard with logo: test/mt5_fvg_zones_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, 693 gaps)
Price came back into a gap within 50 bars 89.7 % of the time (median 2 bars) and fully filled it 77.7 %. A control level at the same distance from another bar's close was revisited 88.6 %: a gap is no stronger a magnet than any level at that distance. "Bounced 73 %" uses a low bar (one gap-height) and must not be advertised. Descriptive only: no edge.

## R&D basis
MQL5 feed 2026-11: non-repainting three-bar FVG detector using closed-bar data (post 4622), FVG aligned with confirmed structure (4514). Own code: gap exists only once the third bar closed; bullish if low[i] > high[i-2], bearish if high[i] < low[i-2]; height >= 0.3 ATR; "touched" = traded into the gap, "filled" = traded through the whole gap.

## Notes / limits
- Gaps whose bar is within the last 50 bars are excluded from the statistics (no future data yet) but are drawn.
- Gap size filter changes counts and numbers; wick-based fill is the strictest/fastest definition.
- Alerts and dashboard corner options were not exercised beyond the screenshot.
