# AT24 Candle Pattern Lab - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_CL_SelfTest.mq5` + `test/verify_cl.py`, 8,000 XAUUSD M15 bars, ATR(14) filter 0.5, 6-bar follow-through) | pattern flags identical on all 8,000 bars; counts, hit rates, baseline rates and mean moves identical for all four patterns |
| MT5 live chart (portable terminal, XAUUSD M15) | BE / SE / PIN markers on closed bars + dashboard with n, hit rate, 95 % interval and the any-bar rate: test/mt5_candle_pattern_lab_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Definitions (closed bars, candles smaller than 0.5 ATR ignored)
- Bullish engulfing: previous candle down, this one up, opens at or below the previous close, closes at or above the previous open, larger body. Bearish engulfing is the mirror.
- Bullish pin bar: body <= 30 % of the range and the lower wick >= 60 % of the range. Bearish pin bar: same with the upper wick.
- Hit: the close 6 bars later is beyond the pattern bar's close in the pattern's direction. Baseline: the same measure over all bars (up rate for bullish, down rate for bearish).

## Real result on one broker feed (XAUUSD M15, 8,000 bars)
| Pattern | n | next 6 bars in its direction | any bar | mean move |
|---|---|---|---|---|
| Bullish engulfing | 470 | 49.1 % (+-4.5) | 47.6 % | -0.62 |
| Bearish engulfing | 502 | 54.8 % (+-4.4) | 52.4 % | +0.77 |
| Bullish pin bar | 540 | 51.5 % (+-4.2) | 47.6 % | +1.35 |
| Bearish pin bar | 557 | 51.2 % (+-4.1) | 52.4 % | -0.54 |

Every pattern sits within about one interval width of the any-bar rate: no demonstrable edge. (The mean moves are price units for 6 bars, small against gold's typical swings.) Descriptive only.

## Notes / limits
- Samples overlap (a pattern's 6-bar window can overlap the next pattern's), so the +-95 % interval is optimistic.
- Other symbols, time frames, filters and follow-through lengths give other numbers; we tested none of the trend/location filters that traders add (e.g. "at support").
- Alerts not exercised beyond a compile.
