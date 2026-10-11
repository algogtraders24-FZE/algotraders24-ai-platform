# AT24 Research Lab - hypothesis registry

Rules: one idea per day; target must have verifiable results; max 2-3 cheap tests per idea; gate = return and drawdown first (annualized return, return/DD, recovery), PF only as a sanity floor; real ticks + spread x2 stress + walk-forward before any ship; >= 8 weeks demo forward via Live Sync before listing. Failed ideas are recorded here so they are not re-run.

| # | Date | Idea | Data / setup | Result | Verdict |
|---|---|---|---|---|---|
| 1 | 2026-10-09 | M12 reversal: fade the PDH/PDL breakout (3 variants) | XAUUSD M15 2025-01..2026-08, 1-min OHLC, evidence inputs | best PF 1.01; others PF 0.80-0.86, DD ~100% | FAIL |
| 2 | 2026-10-09 | M12 shorter TP / break-even / no pyramid (3 variants) | same | +2.1k / +6.1k / -0.15k vs base +19.2k; pyramid is the profit driver | FAIL |
| 3 | 2026-10-11 | AT24 FX Pairs Reversion on AUDCAD vs NZDCAD | H1 2025-01..2026-08, OHLC | net -519, PF 0.66, win 37.5% | FAIL (EA is a spread stat-arb, not the single-pair swing profile of top signals) |
| 4 | 2026-10-09 | Account Guard tester check (naive trader) | EURUSD M15 2026-Q1 | baseline run produced 0 trades; harness flawed | INVALID (no conclusion) |
| 5 | 2026-10-11 | Iron Stops (Market demo, XAUUSD M30) behaviour + screening | Exness-MT5Trial8 demo, 2026-01-01..2026-10-09, 1-min OHLC, $10k, default inputs (risk 1%) | see day-001-iron-stops.md: +6,937, PF 4.45, win 81%, equity DD 4.5%, 75 trades | PROMISING, NOT PROVEN (75 trades < 300; OHLC only; activity bursty) |
| 6 | 2026-10-12 | Control for #5: random / trend-side entries with Iron Stops' observed geometry (SL 3.76 ATR, TP 2.63 ATR, 36 h hold, risk 1%) | same terminal/window, EA = ea-research/lab/AT24_Lab_GeometryBaseline.mq5, 3 random seeds + 1 trend-side | random: -1,134 (PF 0.53) / +548 (PF 1.33) / -192 (PF 0.90), win 40-64%; trend-side -350 (PF 0.82). Iron Stops itself +6,937, PF 4.45, win 81% | Iron Stops' entries beat random with the same geometry: edge is in the entry timing, not the geometry. Trigger still unknown. |
