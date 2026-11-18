# AT24 Regime AI - specification (v1.30, MT5, H1)

Honest purpose: classify every closed H1 bar into one of 5 **learned market states** and show what each state has historically been followed by (size of the next 24-hour range, how long the state lasts). It does not predict direction, gives no buy/sell signal and makes no profit claim.

## 1. R&D result that decided the design (2026-11-18)
- Method: k-means (K=5, z-scored 4 scale-free features), trained once, offline, on the **first 60 % of the H1 history of 12 symbols pooled** (EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, NZDUSD, EURJPY, USDCAD, XAUUSD, US30, US500, USTEC, plus BTCUSD from Binance), tested on the **last 40 %** (out of sample). Data: Exness H1 export (`KX_*`), BTC from Binance public klines.
- Result 1, persistence: a state is the same on the next bar in 83.6 % - 87.4 % of bars (mean run 6.1 - 7.9 bars) on every one of the 13 symbols.
- Result 2, what follows (out of sample, next-24-bar range in ATR(14) units; "all" = average of all bars):
  - states 0 NOISY and 4 STEADY TREND: below average on all 13 symbols (for example EURUSD 4.81 / 4.92 vs all 5.93; US30 4.90 / 5.35 vs all 6.66; BTCUSD 4.98 / 5.38 vs all 6.20).
  - states 1 WIDE SWING and 3 COMPRESSED: above average on all 13 symbols; state 2 STRONG MOVE above average on 12 of 13 (NZDUSD 5.30 vs 5.50 is the exception). Examples 1 / 2 / 3: EURUSD 7.29 / 6.39 / 6.87; US30 8.61 / 8.15 / 7.56; BTCUSD 6.62 / 6.03 / 7.66.
  - Spread between the lowest and highest state: roughly +30 % to +60 % in range size.
- Result 3, limits: the states say how big the next 24 hours tend to be, not which way. Our other tests found no reliable direction edge from price features, so none is claimed. Trained and tested on H1 only. One history sample per symbol.

## 2. Inputs per closed bar i (chronological, index 0 = oldest; all use bars <= i)
- TR_i = max(H_i - L_i, |H_i - C_{i-1}|, |L_i - C_{i-1}|); TR_0 = H_0 - L_0.
- ATR14_i = mean(TR_{i-13..i}), ATR100_i = mean(TR_{i-99..i}) (simple means).
- f1 `er` = |C_i - C_{i-48}| / sum_{j=i-47..i} |C_j - C_{j-1}|.
- f2 `lvol` = ln(ATR14_i / ATR100_i).
- EMA20: alpha = 2/21, EMA_0 = C_0, EMA_j = alpha*C_j + (1-alpha)*EMA_{j-1}. f3 `slope` = min(6, |EMA_i - EMA_{i-10}| / ATR14_i).
- f4 `rngx` = min(30, (max H_{i-23..i} - min L_{i-23..i}) / ATR14_i).
- A bar is valid from index 99 on.

## 3. State
z_k = (f_k - mu_k) / sd_k with fixed constants (mu er 0.163863, lvol -0.031967, slope 1.014311, rngx 5.525808; sd 0.119898, 0.26684, 0.766584, 1.932356). The state is the nearest of 5 fixed centroids (Euclidean distance in z space; the smaller index wins a tie). Centroids in raw units:

| id | name | er | lvol | slope | rngx | pooled out-of-sample next-24 range |
|---|---|---|---|---|---|---|
| 0 | NOISY | 0.1023 | 0.1663 | 0.6141 | 4.3468 | below average |
| 1 | WIDE SWING | 0.1219 | -0.2405 | 1.3098 | 7.4327 | above average |
| 2 | STRONG MOVE | 0.3395 | -0.1325 | 2.6010 | 9.4282 | above average (12 of 13 symbols) |
| 3 | COMPRESSED | 0.1197 | -0.2249 | 0.4958 | 4.6743 | above average |
| 4 | STEADY TREND | 0.2955 | 0.1396 | 1.5741 | 5.6380 | below average |

The constants never change at run time (no learning on the chart, no repaint). A state at bar i never changes afterwards.

## 4. Own-history statistics (shown on the dashboard, with n)
Over the last InpHistBars (default 20000) closed bars of the chart symbol:
- share of bars per state, mean run length, P(stay) = share of bars whose next bar has the same state.
- forward range fr_i = (max H_{i+1..i+24} - min L_{i+1..i+24}) / ATR14_i, known only for bars with 24 later bars. Ratio of a state = mean(fr | state) / mean(fr | all). Shown as "x1.20" with the number of bars n. Under 200 bars in a state: shown as "-" (no claim).
- Current bar: state, run length so far, P(stay), own ratio.

## 5. Output
Dashboard (default off in the Strategy Tester), colour strip of the state per bar in a sub-window, buffers: 0 state (0-4, EMPTY before bar 99), 1 run length, 2 own ratio, 3 P(stay). Optional alert on a state change at bar close. Timeframe other than H1: the dashboard says the model was trained on H1.

## 6. Limits written on the product
Planning information about the size of moves, not direction. Past statistics do not predict future results. Not financial advice.

## 7. v1.10 weekly bias layer
Direction, entry, stop and target come only from the rules of `AT24_Position_Map/SPEC.md` (weekly HH+HL / LH+LL structure, pullback depth, H4 trigger, structural stop, targets 1:3 / 1:4 / 1:5, per-target record with luck test), executed by the unchanged `AT24_PM_Core.mqh` on the chart symbol's weekly and H4 bars (400 / 4500 by default). The panel shows the weekly trend (UP / DOWN / RANGE), the stage ("waiting for a pullback", "wait H4 turn", "TRIGGER ...", "plan running"), the plan (entry, stop, TP1) and the 1:3 record with n. Chart: a buy or sell arrow per plan at its entry bar (last 60 plans) and entry / stop / TP1 lines for the running plan. Alert (optional) when a plan triggers on a closed H4 bar. Buffer 5 = running-plan direction of the last closed bar. The regime state and the bias are independent readings: the state does not change the plan.

## 8. v1.20 tight plan (default) and plan distances
Reason: the Position Map stop sits beyond the weekly pullback extreme, which can be 3-25 % of the price away (XAUUSD example: stop +24 %, TP1 -40 % from the price), too far to use as a trading plan. New input `InpStopMode`:
- `RA_STOP_TURN` (default, tight): same triggers as the Position Map, stop = H4 turn price (the H4 higher low for a long, the lower high for a short; `AT24PM_Ctx.turnPx`, a strict 3-bar H4 swing before the trigger) -/+ 0.25 x ATR(14) of H4 at the trigger bar. Target 1 = entry +/- 3 x risk (input). Walked forward with the unchanged `AT24PM_Walk` (stop first, target, 8-week time stop, spread cost; swap as set). The record shown (average R, n, luck test) is measured with this tight stop on the same triggers. Targets 2 and 3 are not computed in this mode.
- `RA_STOP_STRUCT`: the Position Map plan unchanged (wide stop).
Pure function: `AT24_RA_Plan.mqh` (`AT24RA_TightPlans`).
Dashboard: plan age in days, price now, distance from the price to the stop and to TP1 in %, lots for `InpRiskPercent` (default 0.5 % of balance). A running plan older than `InpFreshDays` (default 10) is shown as OLD in grey, gets no chart lines and no buffer direction. `InpDrawLevels` switches the entry / stop / TP1 lines off. When the H4 trigger exists but its turn was already traded, the panel says "trigger already used".

## 9. v1.30 expected next-24-hour range
Question the panel answers: how big will the next 24 hours be (not which way), so that stops and targets can be sized. Pure core `AT24_RA_Range.mqh`.
- Target: y_i = ln(range / C_i) with range = max H_{i+1..i+24} - min L_{i+1..i+24} (known only for bars with 24 later bars).
- Features at closed bar i (from bar index 150): ln(ATR14_i / C_i), ln(ATR24_i / C_i), ln(ATR120_i / C_i) (simple means of the true range) and the hour-of-day mean of y over the training rows (the symbol's clock pattern; hour of the bar's server time).
- Model: ridge regression (lambda 1, features standardised with population mean / std, intercept = mean of y) fitted on the chart symbol's own last InpHistBars H1 rows with a known target; residual quantiles q10, q50, q90 (linear interpolation) from the training rows. Expected range = C x exp(pred + q50); 80 % band = C x exp(pred + q10) to C x exp(pred + q90). At least 1,500 training rows.
- Honesty check on the panel: a second model fitted on the first 70 % of the rows (48-bar gap) is tested on the last 30 %; "held 77 %" = share of those rows whose real range was inside the band (the band is meant to hold about 80 %).
- R&D (`test/rnd_expected_range.py`, 13 symbols, last 40 % out of sample, R-squared on ln range): ATR only 0.03-0.30; with the hour pattern 0.03-0.39 (XAUUSD 0.26 -> 0.39, US500 0.24 -> 0.39, GBPUSD 0.03 -> 0.18); adding the 5 market states changed R-squared by less than 0.01; the 80 % band held 77-84 % on 12 of 13 symbols (USDCAD, the short history, 84 %). So the market state is not part of the model.
- Buffers 6, 7, 8: expected range, band low, band high in price units at the last closed bar.
Limits: it forecasts size, not direction; a news spike or gap can break the band; the band is estimated from the symbol's own history (a short history gives a rough band).
