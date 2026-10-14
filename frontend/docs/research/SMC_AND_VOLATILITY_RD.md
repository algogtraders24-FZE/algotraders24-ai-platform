# R&D: does the SMC score predict price? Is a volatility range honest?

Date: 2026-10-14. Scripts: `scripts/research/smc-validation.ts`, `scripts/research/vol-calibration.ts` (not part of the product).
Data: Gold (XAUUSD) 1h, 2023-01 to 2026-09 (owner's MT5 export, 21,996 usable bars) and Bitcoin (BTCUSDT) 1h, 2023-01 to 2026-10
(Binance public klines, 33,094 bars). Out-of-sample = 2025-01 onwards; everything before is in-sample.

## 1. Method (no look-ahead)
The production engine (`analyzeSmc`, unchanged) is rolled over the history exactly as the live service runs it: the last 500
closed 1h bars plus the last closed 4h bars; decision at the close of a bar; entry at the NEXT bar's open; forward move measured
`h` hours later (4 / 12 / 24) in ATR units. Confidence intervals are block bootstraps (blocks of 120 bars, about 5 trading days)
because neighbouring decisions overlap. Because Gold rose from 1,826 to 4,290 in this sample, "price went up after a bullish lean"
is flattered by drift, so the test that counts is **bullish-leaning minus bearish-leaning** (raw forward means, drift cancels).

## 2. Result: the SMC score has no reliable directional edge
| | Gold | Bitcoin |
|---|---|---|
| bull - bear forward mean, 12h, all | +0.49 ATR, CI [0.02, 0.94] (significant) | -0.01 ATR, CI [-0.32, 0.32] (none) |
| in-sample / out-of-sample | +0.29 (n.s.) / +0.72 (significant) | -0.09 / +0.08 (both n.s.) |
| 24h, all | +0.67, CI [-0.11, 1.39] (n.s.) | -0.01, CI [-0.57, 0.63] (none) |
| strength "strong" (score >= 70), 12h | +0.13 (n.s.) | -0.39 (n.s., wrong sign) |
| strength "developing" (55-69), 12h | +0.58 (significant) | +0.05 (n.s.) |
| score bands 55-61 / 62-69 / 70+ (signed mean, 12h) | +0.32 / +0.39 / +0.07 | +0.05 / +0.02 / -0.16 |

Reading it honestly:
* Bitcoin: nothing. The lean carries no information about direction at any horizon.
* Gold: bullish leans were followed by better moves than bearish leans at 12h, but only the out-of-sample half and the "developing"
  bucket are significant, in-sample is not, 24h is not, and by year only 2025 is. One instrument in a strong uptrend is not evidence
  of a robust edge; the lean may simply be tracking the trend.
* **The score magnitude does not rank outcomes.** "Strong" (>= 70) is no better than "developing", and on Bitcoin it is worse. The
  owner's weights are therefore not a strength scale.
* Factor attribution: every factor shows the same small positive drift on Gold (it is the market's drift, not the factor); a fresh
  liquidity sweep and premium/discount add nothing measurable on either instrument.

Conclusion: keep SMC as **descriptive structure** (it is a clear, correct summary of swings, BOS/MSS, zones, sweeps), but never
present it as a predictor. Product wording changed accordingly (evidence line, Signals / dashboard tooltips, Copilot caption, AI prompt).

## 3. Result: volatility IS forecastable, so a range is honest
ATR-scaled bands (`ATR(14) x sqrt(h) x m`, m fitted in-sample at the 50/80/90% levels) were checked out-of-sample:

| target | Gold 4/12/24h | Bitcoin 4/12/24h |
|---|---|---|
| 80% band achieved | 80% / 82% / 81% | 78% / 79% / 81% |
| 90% band achieved | 92% / 93% / 91% | 90% / 91% / 91% |
| constant-% band at 80% (for comparison) | 60% / 60% / 61% | 81% / 82% / 84% |

Correlation between current ATR% and the realised size of the next move, out-of-sample: Gold 0.40-0.43, Bitcoin 0.27-0.30.
The ATR band holds its stated coverage overall on both instruments; on Gold the constant-percentage alternative misses badly
(60% instead of 80%), which is the point of conditioning on current volatility.

Known imperfection (disclosed, not hidden): conditional on the volatility regime the band is not uniform - on Gold it covers
about 67% in quiet regimes and 90% in busy ones at the 80% target (mild mean reversion of volatility); Bitcoin is closer to flat
(73-83%). Per-regime multipliers were not consistent across the two instruments (Gold low regime 1.4-1.7 vs Bitcoin 0.9-1.2),
so they were NOT adopted; one pooled multiplier is used: 12h x0.90, 24h x0.95 (80% band).

## 4. What shipped from this
* Evidence line (same source name as the other SMC lines, so no ranking conflicts): "Typical move size (volatility range, not a
  direction or target): about 80% of past moves stayed within 12h +/-X (a%) and 24h +/-Y (b%) - checked out-of-sample on 3.7
  years of Gold and Bitcoin hourly data". It flows to the Market Intelligence report, the AI brief, Copilot and Assistant.
* The SMC lean line now says it showed no reliable directional edge in backtests.

## 5. Limits and next research
* Two instruments, one 3.7-year window, one timeframe. No claim beyond that. Forex pairs and indices are untested (no history on
  hand; the EURUSD 10-year file referenced on the desktop no longer exists).
* Volatility multipliers could be refit per instrument class once more history is available; a GARCH/EWMA volatility estimate
  may beat ATR and is a cheap follow-up.
* Highest-value untested direction: positioning (CFTC Commitment of Traders, weekly, free) as a real sentiment source for Gold,
  FX majors, oil and Bitcoin futures - needs the same out-of-sample test before it is shown.
* Historical-pattern evidence should be empirical base rates from data like this (for example the size distribution above),
  never a claim of directional edge, since none was found.

## 6. Follow-up (2026-10-14): CFTC positioning (COT) - also no detectable directional edge
Script `scripts/research/cot-validation.ts`. Legacy COT, non-commercial net position as a share of open interest, 2017-2026;
published Friday, entry at the next Monday open (no look-ahead), forward return at +1/+2/+4 weeks, trailing-156-week
percentile (never uses later data), 8-week block bootstrap, out-of-sample from 2022. Markets: Gold (COMEX) vs PAXG, Euro FX
(CME) vs EURUSDT, Bitcoin (CME) vs BTCUSDT (spot proxies for the futures; FX/oil/indices not testable with free data on hand).

* Contrarian (crowded-long minus crowded-short, percentile >= 90 vs <= 10) and trend (4-week change up vs down): of 36 tests
  (3 markets x 3 horizons x 2 hypotheses x all/OOS) only 2 reached significance (Euro, out-of-sample, 1-2 weeks, contrarian),
  built on 12 crowded-long weeks - with 36 tests that is what noise produces. Gold and Bitcoin: nothing.
* Power is low: weekly data gives 12-80 extreme observations per market, with confidence intervals of several percent. This can
  rule out large effects, not small ones.

Conclusion: do not present COT positioning as a predictive signal. If it is ever shown, show it as descriptive context
("speculators are net long X% of open interest, Nth percentile of 3 years") with the same disclosure as SMC.

## 7. What the three studies add up to
Free, public data gave no reliable direction signal (SMC structure, COT positioning). It does give a validated size-of-move
forecast (volatility). The product's defensible value is therefore context, risk, volatility and honest labelling - not
direction. Further research should target things that are forecastable (volatility models, event-window volatility around
scheduled releases) rather than more direction hunting.
