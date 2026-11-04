# AT24 indicators: DST-aware clock update (2026-11-04)

Session Range Box, Liquidity Levels, Spread Guard and Anchored VWAP (MT5) now use the shared `AT24_ServerClock.mqh` (PR #398) instead of today's single server offset. On the test feed the old offset was one hour off for about 97% of the last 60 days.

| Indicator | Verification (independent Python calendar, zoneinfo) | What changed in the published numbers (XAUUSD M15) |
|---|---|---|
| Session Range Box | 53 days, 0 mismatches; statistics identical | first break up 40.5 -> 38.1%, down 52.4 -> 50.0%, none 7.1 -> 11.9%; held to day end 51.3 -> 54.1%; ran 1x 33.3 -> 32.4% |
| Liquidity Levels | 89 day/week/month periods, 0 mismatches | sweep frequencies unchanged (PDH 41.5%, PDL 56.6%); after a sweep back inside 57.7 -> 59.6% |
| Spread Guard | hourly profile equal in all 24 hour buckets | bars of summer days move one hour in the profile |
| Anchored VWAP | VWAP/SD equal (5e-6), reversion statistics identical | back to VWAP 79 -> 77%, extended 11 -> 14%, neither 11 -> 9% |

Fallback: if the clock cannot be detected the indicators keep the old behaviour and the dashboard shows "Clock: fixed offset"; detection retries every 10 seconds until the H1 history is loaded. New input `InpDstAware` (default on). Not affected: Prop Guard, Regime Pulse, Trend Pullback Map, Squeeze Meter, Round Levels, Range Detector.
