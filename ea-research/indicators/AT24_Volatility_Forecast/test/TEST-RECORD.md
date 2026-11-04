# AT24 Volatility Forecast - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_VF_SelfTest.mq5` + `test/verify_vf.py`, 8,000 XAUUSD M15 bars, 8-hour horizon = 32 bars, EWMA decay 0.94) | four OHLC estimators (close-to-close, Parkinson, Garman-Klass, Rogers-Satchell), their EWMA forecasts, ATR(14)/close, the naive previous-window forecast and the two time-of-day-seasonal forecasts: calibration (windows, correlation, bias, within +-30 %) identical for all 8; latest forecast values, volatility level and 2,000-bar percentile identical |
| MT5 live chart (portable terminal, XAUUSD M15) | regime + expected 1-sigma/2-sigma move + calibration table + band lines: test/mt5_volatility_forecast_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, 243 non-overlapping 8-hour windows)
How well each forecast made at the start of a window tracked the volatility (close-to-close sigma) realized in the next 8 hours:

| Forecast | correlation | realized / forecast (median) | within +-30 % |
|---|---|---|---|
| Plain EWMA (close-to-close) | 0.09 | 0.99 | 62 % |
| Plain EWMA (Rogers-Satchell) | 0.09 | 0.94 | 61 % |
| ATR(14) / close | 0.10 | 0.63 (runs 37 % low) | 35 % |
| Previous 8 hours realized | 0.11 | 0.99 | 58 % |
| Time-of-day-seasonal EWMA (close-to-close) | 0.32 | 0.89 | 59 % |
| **Time-of-day-seasonal EWMA (Rogers-Satchell)** | **0.39** | 0.90 | **71 %** |

Reading: a plain average (or ATR) barely tracks what comes next because gold's volatility depends heavily on the clock (quiet Asia, busy London/New York); once the time-of-day pattern is built in, the forecast follows the real volatility much better (corr 0.39, 71 % within +-30 %). This is the SIZE of moves, not their direction. The forecast slightly over-predicts (realized / forecast about 0.9).

## R&D basis
MQL5 Code Base library "RealizedVol" (code 78861, 2026-10): range volatility estimators and realized-variance forecasts. Own code and own study: four OHLC estimators, EWMA, a past-only intraday seasonal profile, and the calibration test against baselines.

## Notes / limits
- Per-window correlations come from 243 windows on one symbol and period; other symbols/timeframes/horizons give different numbers. The seasonal profile uses only bars before each forecast (no look-ahead).
- The +-sigma band assumes nothing about direction and real price moves have fatter tails than a normal distribution: treat 1 sigma as "typical", not as a limit.
- Time-of-day slots use the chart's bar times (broker server clock); the pattern is learned from the data, so no time-zone setting is needed. Weekend/holiday gaps shift the schedule by a few slots at most.
- Percentile compares the current de-seasonalised volatility with the last 2,000 bars (about 21 days on M15).
- HAR regression forecasts from the library are not included. Alerts not exercised beyond a compile.
