# AT24 Regime AI - test record (2026-11-18)

## Engine checks
| Check | Result |
|---|---|
| MT5 compile (MetaEditor, portable terminal and the owner's Exness terminal) | indicator, core, self test, unit test: 0 errors, 0 warnings |
| Hand-worked unit tests (`AT24_RA_UnitTest.mq5`) | 31 passed, 0 failed: every centroid classifies to itself, straight-line market (ATR 1.5, ER 1.0, lvol ln(1.5/1.495), slope cap 6, range 16), zig-zag ER 0, flat market invalid, forward range, state statistics (share, run, stay, ratio, 200-bar rule), run length |
| Independent Python (`verify_ra.py`, pandas/numpy re-implementation of SPEC.md) on 5 symbols x 8000 H1 bars | ATR, ER, lvol, slope, range, forward range max difference 5e-11; 0 state mismatches; per-state share, mean run, stay, ratio equal (4.9e-11) |
| No look-ahead (cut-history test in `AT24_RA_SelfTest.mq5`) | EURUSD and XAUUSD, 3 cuts each: 0 differing states |
| Real chart (MT5, XAUUSD H1, iCustom) | dashboard, logo, colour strip render; buffers readable (state, run, ratio): test/mt5_regime_ai_chart.png |

## R&D that decided the design (out of sample)
Method: k-means K=5 on 4 scale-free features (z-scored), trained on the first 60 % of the H1 history of 12 symbols pooled, tested on the last 40 %. Data: Exness H1 export; BTCUSD from Binance public klines (spot, not a CFD feed). Script and numbers: `rnd_regime_states.py`, `rnd_regime_states_result.json`.

Learned centroids (er, lvol, slope, rngx): NOISY 0.10 / 0.17 / 0.61 / 4.35; WIDE SWING 0.12 / -0.24 / 1.31 / 7.43; STRONG MOVE 0.34 / -0.13 / 2.60 / 9.43; COMPRESSED 0.12 / -0.22 / 0.50 / 4.67; STEADY TREND 0.30 / 0.14 / 1.57 / 5.64.

| Symbol | test bars | state stays next bar | mean run (bars) | next-24-bar range in ATR(14) by state 0 / 1 / 2 / 3 / 4 | all bars |
|---|---|---|---|---|---|
| AUDUSD | 23951 | 85.1 % | 6.7 | 4.83 / 6.25 / 5.62 / 6.37 / 4.91 | 5.55 |
| BTCUSD | 32202 | 87.4 % | 7.9 | 4.98 / 6.62 / 6.03 / 7.66 / 5.38 | 6.2 |
| EURJPY | 23951 | 85.4 % | 6.8 | 4.94 / 6.39 / 6.47 / 6.2 / 5.17 | 5.65 |
| EURUSD | 19146 | 84.8 % | 6.6 | 4.81 / 7.29 / 6.39 / 6.87 / 4.92 | 5.93 |
| GBPUSD | 23951 | 84.8 % | 6.6 | 4.75 / 7.11 / 6.22 / 6.82 / 4.81 | 5.82 |
| NZDUSD | 23951 | 85.5 % | 6.9 | 4.94 / 6.14 / 5.3 / 6.18 / 4.92 | 5.5 |
| US30 | 23951 | 83.6 % | 6.1 | 4.9 / 8.61 / 8.15 / 7.56 / 5.35 | 6.66 |
| US500 | 23951 | 84.3 % | 6.3 | 5.05 / 8.28 / 7.4 / 7.6 / 5.23 | 6.52 |
| USDCAD | 4622 | 84.6 % | 6.5 | 4.79 / 6.76 / 6.33 / 6.41 / 4.93 | 5.63 |
| USDCHF | 23951 | 85.1 % | 6.7 | 4.73 / 6.87 / 6.49 / 6.49 / 4.95 | 5.73 |
| USDJPY | 23951 | 85.5 % | 6.9 | 4.97 / 6.72 / 6.33 / 6.89 / 5.55 | 6.04 |
| USTEC | 23951 | 84.2 % | 6.3 | 5.05 / 8.23 / 7.48 / 7.72 / 5.34 | 6.57 |
| XAUUSD | 23951 | 85.3 % | 6.8 | 5.0 / 6.74 / 5.99 / 6.94 / 5.18 | 5.93 |

Reading: states 0 NOISY and 4 STEADY TREND are followed by a smaller than average next-24-bar range on all 13 symbols; states 1 WIDE SWING and 3 COMPRESSED by a larger one on all 13; state 2 STRONG MOVE by a larger one on 12 of 13 (NZDUSD slightly below). The states persist (83.6 % - 87.4 % stay). This is about the SIZE of the next moves, not direction.

## Honest limits
- One feed per symbol; BTC data is spot from another source. USDCAD has a short history (4,622 test bars).
- H1 only; other timeframes show a notice. The constants are fixed and were not tuned per symbol.
- The dashboard statistics are the chart symbol's own history (last 20,000 closed bars by default) and are descriptive: they say what followed in the past. No forward (live) record yet; a 30-day demo forward check by the Engineering window is still open.
- Not verified live: alerts and push, the first calculation time on a 100,000-bar chart (InpMaxBars limits it to 30,000), other brokers' symbol names.
- No trade, no signal, no profit claim.
