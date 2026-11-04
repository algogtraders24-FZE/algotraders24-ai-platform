# AT24 Anchored VWAP - test record (2026-11-03, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 core maths vs independent Python (`mt5/AT24_VWAP_SelfTest.mq5`, 8,000 XAUUSD M15 bars, tick volume) | day / week / month VWAP and volume-weighted SD equal (max diff 5e-6 VWAP, 6e-5 SD = CSV rounding); mean-reversion test identical: 85 events, 67 reverted, 9 extended, 9 neither; closes above day VWAP 47.787% of 7,048 bars |
| MT5 live chart (portable terminal, XAUUSD M15) | day VWAP + SD bands, week and month VWAP, dashboard with logo and statistics: test/mt5_anchored_vwap_chart.png |
| MT4 / TradingView | not built (owner decision 2026-11-03: MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, 85 completed days)
After the first close 2 SD from the day VWAP (once per day, from the 11th bar of the day): price traded back to the VWAP before the day ended in about 77% of days (66/86, DST-aware clock), went on to a 3 SD close in 14% (12/86), neither 9% (8/86). (Before the DST fix: 79% / 11% / 11% over 85 days.) Closes above the day VWAP: 47.8% of bars. Random-walk yardstick for fixed barriers (2 SD back vs 1 SD further) is about 33% back, BUT the VWAP itself drifts toward price during the day, which makes touching it easier, so the 79% is NOT an edge and must not be sold as one: a touch is not a profit, stretches can run first, costs are ignored.

## Notes / limits
- Volume is TICK volume (what MT5 provides for FX/CFDs), not real traded volume; VWAP shape depends on the broker's tick feed.
- Day / week (Monday) / month anchors are GMT; the server-to-GMT conversion uses the current offset, so days across a daylight-saving change can be one hour off (an MQL5 library post on 2026-11-03 describes the same broker-DST problem; a DST-aware server-time helper is a candidate improvement for all AT24 indicators).
- Statistics use closed bars only; the VWAP lines include the forming bar.
- Alerts and the live dashboard clock were not exercised beyond a screenshot.

## DST-aware clock update (2026-11-04)
The GMT sessions/days now use the shared AT24 Server Clock (`AT24_ServerClock.mqh`, detects the broker's daylight-time rule from the weekly close in the H1 history) instead of today's single offset, which was one hour off for about 97% of the last 60 days on this feed. The core maths is unchanged: the indicator converts every bar to GMT with the clock, calls the core with offset 0 and converts returned times back for drawing. If the clock cannot be detected (not enough H1 history, other weekly schedule) it falls back to the old offset and the dashboard shows "Clock: fixed offset"; the detection retries every 10 seconds until the H1 history has loaded.
Verification: day/week/month VWAP and SD equal an independent Python calculation with true GMT keys (max diff 5e-6 / 6e-5), 0 anchor-flag mismatches; reversion statistics identical (86 events, 66 reverted, 12 extended, 8 neither, 47.436% above on 6,980 bars).
