# AT24 Squeeze Meter - test record (2026-11-03)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 core maths vs independent Python (`mt5/AT24_Squeeze_SelfTest.mq5`, 8,000 XAUUSD M15 bars) | Bollinger mid / momentum difference 2e-12, ATR and band ratio 5e-6; squeeze state 0 mismatches; all 137 releases identical (bar, squeeze length, momentum sign, up/down/range excursions); statistics identical (baseline 4.491 ATR, median post-release range 4.266 ATR, above-baseline 44.5%, momentum match 46.7%) |
| MT5 live chart (portable terminal, XAUUSD M15) | momentum histogram + squeeze dots in the sub-window and the branded dashboard: test/mt5_squeeze_meter_chart.png |
| MT4 compile | 0 errors, 0 warnings |
| MT4 runtime (portable MT4 copy, test EA reading all 7 buffers through iCustom for 400 bars) | 400 bars, 0 mismatches: momentum (4 colour buffers), squeeze dots on/off, squeeze state (108 squeeze-on bars in range) |
| TradingView Pine v5 | written, **NOT compiled or tested** (Claude in Chrome was disconnected at the time). Must be pasted into the Pine editor and checked before release |

## Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, 137 squeezes of at least 6 bars)
Median squeeze length 12 bars. The next 20 bars had a median range of 4.27 ATR versus 4.49 ATR for ANY 20 bars, and the range was wider than the usual range after only 44.5% of releases. The momentum sign matched the bigger side 46.7% of the time (coin flip). So on this data a squeeze did not signal a bigger-than-usual move. Descriptive only.

## Bugs found / notes
1. MQL4 newest-first arrays: read through a chronological index (lesson from earlier indicators); an MT4 8-buffer limit is respected by splitting the momentum colours into four buffers.
2. Pine uses ta.atr (Wilder RMA seed) while MT4/MT5 seed the ATR with a running mean, so small differences are expected.

## Limits
- Momentum is a plain "close minus mean of (donchian mid, SMA)" value, not the linear-regression variant some platforms use.
- Statistics depend on the squeeze definition, minimum length (6) and window (20); other settings give other numbers.
- Alerts and the live dashboard clock were not exercised beyond a screenshot.
