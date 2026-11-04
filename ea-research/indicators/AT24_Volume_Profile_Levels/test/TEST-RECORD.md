# AT24 Volume Profile Levels - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_VP_SelfTest.mq5` + `test/verify_vp.py`, 8,000 XAUUSD M15 bars = 88 server days, 60 bins, 70 % value area) | all 88 daily profiles identical (POC, VAH, VAL, bar range of each day); the level study identical for POC, VAH and VAL (days, touch %, control touch %, reaction %, control reaction %, decided touches) |
| MT5 live chart (portable terminal, XAUUSD M15) | yesterday's value area shaded across today, POC / VAH / VAL lines with labels, dashboard with logo and statistics: test/mt5_volume_profile_levels_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Method
- Profile per server day from TICK volume (broker feed, not exchange volume): each bar's volume is spread evenly over the price bins its high-low covers. POC = busiest bin centre. Value area = start at the POC bin and add the larger neighbouring bin (ties: upper) until 70 % of the volume is inside.
- Study for each day with a previous profile: touch = some bar's range contains the level. Control = the level mirrored through the day's open (same distance, other side). Reaction (decided touches only): after the first touch, within 24 bars the close moves 0.15 x the previous day's range away from the level on the side the day opened (reacted) before closing that far beyond it (broke). The reaction size and look-ahead (0.15, 24 bars) were fixed so that about 50 decided touches exist per level; a first try with 0.25 / 8 bars left only 15 decided touches per level and was dropped for that reason, not for its outcome.

## Real result on one broker feed (XAUUSD M15, 87 days)
| Level | touched today | control touched | reacted (decided touches) | control reacted |
|---|---|---|---|---|
| POC | 67.8 % | 63.2 % | 44.4 % of 54 | 53.8 % |
| VAH | 69.0 % | 56.3 % | 63.5 % of 52 | 51.1 % |
| VAL | 66.7 % | 60.9 % | 54.4 % of 57 | 45.8 % |

Yesterday's levels were touched somewhat more often than the mirrored control levels (67-69 % vs 56-63 %; each about +-10 points of noise on 87 days), and the reaction rates (+-13 points) do not differ from the controls. On this sample: no demonstrable edge. Descriptive only.

## Notes / limits
- Tick volume counts price changes, not traded contracts; profiles differ between brokers.
- Days are server-time days; the last (current) day has no profile of its own yet.
- 87 days is a small sample; other symbols/periods may differ. Alerts (close back inside/outside the value area) not exercised beyond a compile.
