# AT24 Server Clock helper - test record (2026-11-03)

Shared include: `mt5/AT24_ServerClock.mqh` (own implementation of the idea in the MQL5 library post "BrokerClock", code 78825, 2026-10-30: read the broker's GMT offset and daylight-time rule from the weekly close in the H1 history).

| Check | Result |
|---|---|
| MT5 compile (self-test script) | 0 errors, 0 warnings |
| Detection on the Equiti demo feed, XAUUSD H1, 64 weekends | base GMT+2, rule = US daylight time; the latest 8 weekends 8/8 explained, 61 of 64 weekends explained overall |
| Independent Python check (`test/verify_servercheck.py`, zoneinfo America/New_York + Europe/Berlin) | the best (base, rule) over all candidates is the same (2, US) with the same scores (8, 61); all 64 weekly-close instants are Friday 17:00 New York; 1,600 server->GMT conversions over 400 days: 0 mismatches against the independent calendar |
| The 3 unexplained weekends | 2025-11-28, 2026-06-19, 2026-07-03: holiday early closes (the market closed earlier than 17:00 New York), so the measured offset is off by whole hours; the vote ignores them |

## Why it matters (measured on this feed)
A single "current offset" (what AT24 indicators used so far: today's TimeTradeServer() - TimeGMT(), which is GMT+2 in winter) is 1 hour wrong for 67.8% of the last 400 days (every day under US summer time). Our "last 60 days" statistics for Session Range Box, Liquidity Levels, Anchored VWAP and Spread Guard were therefore built on GMT day/session boundaries that were one hour early for about 97% of those days (the 60 days run from early September to early November, i.e. US summer time until Nov 1). In the same portable-terminal run the live offset read 0 s at script start (before the connection was up), showing how fragile the live clock is; the Strategy Tester always reports 0.

## Limits
- Needs about 60 weekends of H1 history (6 minimum) and a broker whose week closes at 17:00 New York (FX, metals, many index CFDs). Crypto or other schedules fall back to the live offset (`ok` = false).
- Holiday early closes are ignored by the vote; if most of the history is winter only, fixed and US rules can tie (the history window must span a daylight-time change).
- Detection copies up to about 60 weeks of H1 bars: refresh it once an hour, not per tick.
- Not yet integrated into the AT24 indicators (next step, one indicator at a time with re-verification).
