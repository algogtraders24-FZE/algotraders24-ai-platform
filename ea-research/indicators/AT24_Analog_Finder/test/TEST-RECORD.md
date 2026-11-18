# AT24 Analog Finder - test record (2026-11-18)

## Engine checks
| Check | Result |
|---|---|
| MT5 compile | indicator, core, self test, unit test: 0 errors, 0 warnings |
| Hand-worked unit tests (`AT24_AF_UnitTest.mq5`) | 32 passed, 0 failed: quantiles, the 12 features on a straight line (returns 2 / 4 / 8 / 16 / 32 ATR, RSI 100, EMA20 / 50 / 200 lags 9.5 / 24.5 / 99.5 bars, 47.5 / 48 position), outcome known up to n-25, scaling on synthetic rows (mean 527.5, population sd of 556 integers), analog search (nearest first 500, 524, 476, 548, 452, all 30 at least 24 bars apart, inside the candidate rows), one analog when all candidates are close, self-test on an all-up outcome (63 test points, all selected, hit 100 %, luck test worked) and on a feature that does not tell outcomes apart |
| Independent Python (`verify_af.py`, numpy re-implementation of SPEC.md) on 5 symbols x 9,000 H1 bars | features and outcome max difference 1.5e-12 (every 7th row); **the 30 analog bar indices identical**; mean, quantiles, share up, mean distance, self-test band-held, hit, average, luck-test p and always-long max difference 5.7e-13; counts and class identical |
| No look-ahead (cut-history test in `AT24_AF_SelfTest.mq5`) | EURUSD and XAUUSD, 3 cuts each: 0 differing feature values or known-flags |
| Real chart (MT5, XAUUSD H1, iCustom, 12,000 bars) | dashboard with the histogram, 30 chart markers, buffers read back identical (median 3807.277, band 3684.10 - 3859.58, share up 0.80): test/mt5_analog_finder_chart.png |

## R&D that decided the design (out of sample)
`rnd_analogs.py`, `rnd_analogs_result.json`: 13 symbols, K = 30 analogs 24 bars apart, test points every 24th bar of the last 40 %. Direction: hit 52.3 % on average (46.6 % - 56.5 %), only USTEC (p 0.01) and US30 (p 0.07) passed the luck test and both are strongly rising indices; so no direction edge is claimed and the dashboard says "direction NOT RELIABLE here" unless the symbol's own self-test passes. Band: the analogs' 10 - 90 % band held 71.5 % - 79.1 % (mean 75.7 %) of the test points.

## Self-test results on the demo feed (9,000 H1 bars, 146 test points each)
EURUSD band held 78.1 %, direction hit 53.7 % (n 67, p 0.20); XAUUSD 73.3 %, hit 48.4 % (n 64, p 0.98); GBPUSD 71.9 %, 42.4 % (n 59, p 0.80); USDJPY 82.2 %, 61.4 % (n 83, p 0.13); USDCHF 76.7 %, 58.2 % (n 55, p 0.18). None passes the luck test (p < 0.10): the panel shows "NOT RELIABLE here" on all five.

## Honest limits
- Direction was not reliable on most symbols; the product's value is the picture of what followed, its 80 % band (about 76 % held) and the self-test that says so on each symbol.
- Features describe only the last two days of price. The scaling uses the first 60 % of the history for both the self-test and the live search.
- The self-test is recomputed every 24 H1 bars (a few seconds on 12,000 bars); the search every new bar.
- Not verified live: other brokers, very long histories (InpBars up to 100,000), forward record. No signal, no trade, no profit claim.
