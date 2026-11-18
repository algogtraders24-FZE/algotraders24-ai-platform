# AT24 Regime AI - test record (v1.00 engine 2026-11-18, v1.10 weekly bias + new dashboard 2026-11-18)

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

## v1.10 additions: weekly bias, arrows, new 3D dashboard
- The weekly bias is the **unchanged, already verified AT24 Position Map core** (`AT24_PM_Core.mqh`, `AT24_TT_Core.mqh`, copies of the Position Map files). Its own record: 29 unit tests, independent Python identical on every swing, trend bar, setup and score (see the Position Map test record).
- Cross-check of the new glue code (same defaults 4500 H4 / 400 weekly bars, offline test terminal): XAUUSD bias DOWN, short plan running, entry 4091.59, stop 4703.22, TP1 2256.70, record +1.54 R (10); EURUSD bias DOWN, short plan running, entry 1.13412, stop 1.17164, TP1 1.02157, record +0.24 R (8). Entry, stop and target are identical to the Position Map / Position Scanner on the same bars. The two records differ from the Scanner screenshot (7000 bars: +1.06 R (19)) only because fewer H4 bars are read here.
- Chart arrows: one per plan found by the rules (last 60), at the H4 bar where the entry happens (a trigger waiting for the next open is drawn at the next bar). XAUUSD: 11 arrows (5 buy, 6 sell) for 10 scored plans + 1 running; EURUSD: 9 (4 buy, 5 sell). The running plan also draws entry / stop / TP1 lines.
- A new buffer 5 gives the running-plan direction of the last closed bar (+1 long, -1 short, 0 none).
- Bugs found and fixed while building the dashboard: first version overlapped the logo; the bias stayed on "loading" in a terminal whose weekly history was not loaded yet (a 3-second timer now retries); a chart change reset the range columns to 1 px (columns are created once and the chart-change handler redraws).
- Not verified live: alerts and push (state change, trigger), real-account swap, other brokers, forward record. The weekly-bias records are small samples (n under 30 each) and are shown with n.
- Honest framing kept: the state says how big moves tend to be; the direction is the weekly-structure rule set with its record, not a forecast. Our tests have not shown a reliable direction edge from price features.

## v1.20: tight plan, plan age and distances (2026-11-18)
- Owner feedback: entry / stop / TP1 were far from the price (XAUUSD short: entry 4091.64, stop 4703.15 = +24 %, TP1 2257 = -40 %; EURUSD: stop 3.7 % and TP1 10 % away) and the entry could be weeks old.
- Fix: tight stop beyond the H4 turn (default), plan age, price now and % distance to stop / TP1, lots for the risk percent, OLD marking after 10 days, lines optional, "trigger already used" text.
- Verification of the new rule: `AT24_RA_PlanDump.mq5` dumps the H4 bars and every tight plan; `verify_ra_plan.py` recomputes from the bars, independently: the turn is a strict 3-bar H4 swing before the trigger, stop, risk, target 1, walk-forward result (stop first, target, 8-week time stop, cost). 56 plans on XAUUSD (11), EURUSD (9), GBPUSD (7), USDJPY (12), USDCHF (17): 0 mismatches, max R difference 5e-11. The triggers and the walk function are the unchanged Position Map core.
- Records with the tight stop (offline demo feed, same 4500 H4 / 400 weekly bars): XAUUSD +1.25 R (11), EURUSD +0.76 R (9), GBPUSD +0.07 R (7), USDJPY -0.39 R (12), USDCHF -0.37 R (16). All n under 30: small samples, shown with n. No claim.
- Real chart (USDCHF H1): OLD LONG plan, entry 0.82058, stop 0.81249, TP1 0.84485, price now 0.84248, "to SL -3.6 %, to TP1 +0.3 %, 0.5 % risk = 0.04 lots": test/mt5_regime_ai_chart.png.
- Not verified live: alerts and push, real swap, forward record, other brokers.

## v1.30: expected next-24-hour range (2026-11-18)
| Check | Result |
|---|---|
| MT5 compile | indicator, core, unit test, self test: 0 errors, 0 warnings |
| Hand-worked unit tests (`AT24_RR_UnitTest.mq5`) | 23 passed, 0 failed: quantiles (1..5 -> 1.4, 3, 4.6), 2x2 and 3x3 linear solve incl. a row swap and a singular matrix, hour of a timestamp, features and target on constant bars (ln 0.02), valid from bar 150, target known up to n-25, short history, full run on constant bars (range exactly 2.0, band 2.0 - 2.0, coverage 100 %), too short = no model, price scaling (4.0 units, 2.0 %), periodic volatility gives a finite band |
| Independent Python (`verify_rr.py`, numpy re-implementation) on 5 symbols x 20,000 H1 bars | validity flags identical; features and target max difference 3e-12; ridge fit, quantiles, out-of-sample coverage, final range and band max difference 4e-11; row counts identical |
| No look-ahead (cut-history test in `AT24_RR_SelfTest.mq5`) | EURUSD and XAUUSD, 3 cuts each: 0 differing feature rows |
| Result on the demo feed (20,000 H1 bars) | XAUUSD 2.35 % typical (band 56.7 - 153.8), band held 76.8 % of 5,949 test rows; EURUSD 0.52 % held 77.7 %; GBPUSD 0.54 % held 77.5 %; USDJPY 0.55 % held 77.7 %; USDCHF 0.59 % held 81.7 % |
| Real chart (MT5, XAUUSD H1) | left card shows "next 24 h range ~ 89.22 (2.36 %)", "80 % band 56.72 - 153.59 held 77 %"; buffers 6-8 read back identical: branding/screenshot_mt5.png |
Limits: held 77-82 % means the band is slightly narrow on some symbols; not verified live: alerts, other brokers, forward record.
