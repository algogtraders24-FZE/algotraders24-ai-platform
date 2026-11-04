# Indicator series - handover to the Engineering / Production window (2026-11-02)

Owner decision: the engineering-production agent takes over the remaining work (listing + fine tuning). Nothing below is committed; the working branch at hand-off was `feat/marketplace-demo-tested-utility-badge` (unrelated), so create a clean branch from main before committing.

## Owner rules (apply to every indicator)
- Each indicator has its OWN brand name, logo, dashboard. Platforms: MT5, MT4, TradingView.
- After building each one: audit the code, compile, test on the terminal, then write a marketing brief for the marketing agent (`docs/social/INDICATORS/`).
- Honest labelling only: context tools, never "signals", no fake stats / fake VALIDATED. Dashboards OFF in the Strategy Tester by default.
- Keep tests short. Do not touch the owner's live accounts. Terminal B (`C:\Program Files\MetaTrader 5`) is used by another window's EA (do not close it); terminal A (Equiti install folder, data dir `8762A67661860246215827420BCD27F8`, IC Markets demo) was my test rig.

## Delivered (my production is finished)
| # | Product | Folder | MT5 | MT4 | TradingView |
|---|---|---|---|---|---|
| 1 | AT24 Regime Pulse (trend quality ER, ATR-percentile volatility rank, spread/ATR, session, regime label) | `ea-research/indicators/AT24_Regime_Pulse` | compiled, math = Python, live chart screenshot | compiled, runtime values = Python (found+fixed a newest-first array bug) | compiled + rendered in the Pine editor, screenshot |
| 2 | AT24 Spread Guard (spread by GMT hour, live vs typical, cost % of ATR, 24h mini chart, spike alert) | `ea-research/indicators/AT24_Spread_Guard` | compiled, math = Python, live chart screenshot | compiled; same array bug fixed in source; runtime NOT verified | compiled + rendered (range-based edition; TradingView has no spread), screenshot |

Each folder has `branding/` (logo, banner, MT5 + TradingView screenshots), `test/TEST-RECORD.md`; briefs in `docs/social/INDICATORS/AT24-REGIME-PULSE-BRIEF.md` and `AT24-SPREAD-GUARD-BRIEF.md`. Both indicators have their own resource file names (`logo56.bmp` / `sg_logo56.bmp`), so they can share one folder.

| L1 | AT24 Session Range Box (list #1: Asia box + real breakout statistics) | `ea-research/indicators/AT24_Session_Range_Box` | compiled, math = Python (43 days, 0 mismatches), screenshot | compiled, runtime values = Python | compiled + rendered, screenshot |
| 3 | AT24 Prop Guard (daily/max loss gauges, open risk, target progress, alerts) | `ea-research/indicators/AT24_Prop_Guard` | compiled; 22/22 self-test checks on a live demo; screenshot | compiled; 6/6 runtime checks on a demo | compiled + rendered (calculator edition, cannot read the account), screenshot |
| L2 | AT24 Liquidity Levels (list #2: PDH/PDL/PWH/PWL/PMH/PML + sweep stats) | `ea-research/indicators/AT24_Liquidity_Levels` | compiled, math = Python (89 periods, 0 mismatches), screenshot | compiled, runtime levels = Python | compiled + rendered, screenshot |

Prop Guard open item: test open risk with a real open demo trade (only the no-position case was verified). Brief: `docs/social/INDICATORS/AT24-PROP-GUARD-BRIEF.md`.

| L3 | AT24 Trend Pullback Map (list #3: EMA ribbon, trend/range, pullback zone + real pullback outcomes) | `ea-research/indicators/AT24_Trend_Pullback_Map` | compiled, math = Python (8,000 bars, 438 events identical), screenshot | compiled, runtime buffers = Python (400 bars) | compiled + rendered, screenshot |
| L4 | AT24 Squeeze Meter (list #4: Bollinger-in-Keltner squeeze + momentum + real post-squeeze stats) | `ea-research/indicators/AT24_Squeeze_Meter` | compiled, math = Python (137 releases identical), screenshot | compiled, runtime buffers = Python (400 bars) | written, NOT tested (Chrome was disconnected) |

| L6 | AT24 Round Levels (list #6: round-number grid + real bounce test vs control levels) | `ea-research/indicators/AT24_Round_Levels` | compiled, math = Python (6 scans identical), screenshot | compiled, runtime statistics = Python | written, NOT tested (Chrome was disconnected) |

**MT4 label limit (found 2026-11-03):** MT4 cuts object-label text at 63 characters. All MT4 dashboards were audited; three over-long lines were shortened (fix included with Round Levels).

| L8 | AT24 Anchored VWAP (list #8: day/week/month VWAP + SD bands + real reversion test; MT5 only) | `ea-research/indicators/AT24_Anchored_VWAP` | compiled, math = Python (VWAP, SD and reversion stats identical), screenshot | not built | not built |
| L9 | AT24 Range Detector (list #9: ADX-fade consolidation boxes + real range-ending statistics; MT5 only) | `ea-research/indicators/AT24_Range_Detector` | compiled, math = Python (153 ranges identical), screenshot | not built | not built |
| L10 | AT24 Auto Fib Zones (list #10: fib levels on the last confirmed swing leg + real pullback-depth statistics; MT5 only) | `ea-research/indicators/AT24_Auto_Fib_Zones` | compiled, math = Python (785 swings, 782 legs identical), screenshot | not built | not built |
| L11 | AT24 Market Structure (list #13: BOS / CHoCH on confirmed swings + real follow-through statistics; MT5 only) | `ea-research/indicators/AT24_Market_Structure` | compiled, math = Python (364 events identical), screenshot | not built | not built |
| L12 | AT24 FVG Zones (list #14: open fair value gaps on closed bars + real revisit/fill statistics with a control level; MT5 only) | `ea-research/indicators/AT24_FVG_Zones` | compiled, math = Python (693 gaps identical), screenshot | not built | not built |

## Open items for the production window
1. **Spread Guard on MT4:** drag it onto an MT4 chart and eyeball dashboard + histogram (my test read no values; the Exness demo history spread may be zero). If the histogram stays empty only because history spread is 0, the live-learning profile fills over time; the dashboard still works.
2. **Side effect in the owner's MT4 terminal:** my startup-config attempts left an extra XAUUSD M5 chart (the test EA file is deleted, so nothing runs). The owner can close that chart. MT4 note: the ini path is passed WITHOUT `/config:` (MT4 syntax); MT5 uses `/config:`.
3. **Listing (the production window's job):** pricing/positioning (suggested: free lead-magnet or low-price utilities, no Trust State, "Context tool - not a signal"), upload packages (.ex5/.ex4 + .mqh/.bmp sources, README, .pine text), listing copy from the briefs. Owner-only steps (publishing, attestations) stay with the owner. Use the Announcements system for the release email (draft only; owner approves).
4. **Fine tuning (optional):** Regime Pulse colours/legend; defaults for `InpMaxBars` (5000); Spread Guard thresholds.
5. **Licence gate:** not added (free tools). If sold, add `AT24_LicenseGate.mqh` like the EAs.
6. **Next indicators (owner: keep building one by one):** candidates from `ea-research/mql5-feed/research/INDICATOR_CATALOG.md`: Hurst/trend-persistence, Kalman trend, session/volume profile, prop-firm daily-loss overlay, BOS/CHoCH, FVG. Each needs its own name, logo, dashboard.

## Facts the production window must not lose
- Regimes are descriptive, NOT predictive: the next-20-bar ER was ~0.21-0.24 in every regime (XAUUSD M5, 2025-26, 54k bars). Spread/ATR median: strong trend 6%, chop 7%, mixed 8%, range 10%, trend 10%, quiet 13%.
- IC Markets Raw demo stores a flat historical bar spread (17-18 pts at all hours), so Spread Guard learns from live ticks and says so on the panel.
- MQL4 gives OnCalculate arrays newest-first (copy to chronological arrays); MT5 `#resource` only compiled when the source sat inside the terminal data folder; MQL4 rejects a variable name redeclared in a nested scope; MT4 has no TimeTradeServer(); iCustom parameter lists in MT5 include `input group` headers as slots.
- Logo: official AT24 infinity mark `frontend/public/brand/logo-512.png` (Regime Pulse dashboard); Spread Guard has its own shield icon.
