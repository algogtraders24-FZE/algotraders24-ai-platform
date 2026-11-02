# AT24 Regime Pulse - test record (2026-11-02)

| Check | Result |
|---|---|
| MT5 compile (MetaEditor, Equiti/IC terminal A and Exness data dir) | 0 errors, 0 warnings |
| MT4 compile (Vantage MetaEditor) | 0 errors, 0 warnings |
| MT4 runtime (Vantage MT4 terminal, Exness demo XAUUSD M5, 700 bars read through iCustom by a test EA) | ER matches Python (max diff 5e-5, rounding), volatility rank matches (1e-15) |
| Math vs independent Python on 4,000 XAUUSD M5 bars | ATR, ER max diff 5e-7, vol-rank 5e-4 (CSV rounding), no NaN mismatch |
| Incremental recalculation (last 50 bars) vs full | identical (diff 0) |
| Live chart (MT5, XAUUSD M5, terminal A) | dashboard + logo + coloured histogram + rank line render: test/mt5_regime_pulse_chart.png |
| TradingView Pine v5 | compiled in the Pine editor ("Compiled. Added to chart."), renders histogram + table; STRONG TREND ER 0.46 rank 89 at the time: branding/screenshot_tradingview.jpg |

## Bugs found and fixed during the audit
0. MT4 runtime test found a real bug: MQL4 hands OnCalculate arrays newest-first, so the first MT4 build computed ER on reversed data (values did not match Python). Fixed with chronological copies; re-test matches. (MT5 is unaffected, verified.)
1. Dashboard text misplaced in right/lower corners -> all objects now anchored left-upper, base computed from chart size.
2. First calculation on a 100,000-bar chart took over 30 s (panel stayed empty) -> new input InpMaxBars (default 5000).
3. MT4 compiler rejects a variable name re-declared in a nested scope -> loop variables renamed.
4. Note for EA/iCustom callers: input group headers occupy parameter slots (23 slots); passing values by position without them misaligns every parameter.

## Regime behaviour (XAUUSD M5, 2025-26, 54k bars) - why it is not a signal
ER of the next 20 bars: CHOP 0.23, MIXED 0.23, QUIET 0.24, RANGE 0.23, STRONG 0.21, TREND 0.24 -> no persistence. Median spread/ATR: STRONG 6%, CHOP 7%, MIXED 8%, RANGE 10%, TREND 10%, QUIET 13%.
