# AT24 Gold Breakout v1.03 (from XXX Gold v1.02)

Same fixes as the Index build (see ../../index-product-01/source/CHANGELOG-v1.03.md): HistorySelect, profit factor, no stacked orders,
prop-mode base balance, lot/margin checks, Eclipse fractal, AT24 licence guard.

Gold specifics: v1.02 already had an effective point (100 points = $1.00 on 2-digit and 3-digit brokers). v1.03 keeps it and now uses it
for the spread shield and the dashboard too, so all distances and the spread are in the same unit. OnInit prints digits, effective point,
SL, TP and the spread, and warns if the stop is under 3x the spread or the symbol is not gold.

Compiles with MetaEditor64 (0 errors, 0 warnings). NOT run in the Strategy Tester or on a demo. v1.02 evidence does not apply
(fixes 3 and 7 change behaviour). Gold already has a validated product (PDHPDL-GOLD, $299); do not mix its evidence with this EA.

Before it is sold: set AT24_TRADING_SYSTEM_ID / AT24_VERSION_ID to the registered ids, allow the AT24 URL for WebRequest, deliver the
.ex5 only, do not market it as AI (rule-based breakout), and run a fresh backtest plus a demo.
