# AT24 BTC Breakout v1.03 (from XXX BTC-USD v1.02)

Same fixes as the Index build (see ../../index-product-01/source/CHANGELOG-v1.03.md): HistorySelect, profit factor, no stacked orders,
prop-mode base balance, lot/margin checks, Eclipse fractal, AT24 licence guard. Fix 5 (point mode) is not needed: BTC distances were
already USD price units.

Compiles with MetaEditor64 (0 errors, 0 warnings). NOT run in the Strategy Tester or on a demo. v1.02 evidence does not apply
(fixes 3 and 7 change behaviour).

Before it is sold: set AT24_TRADING_SYSTEM_ID / AT24_VERSION_ID to the registered ids, allow the AT24 URL for WebRequest, deliver the
.ex5 only, do not market it as AI (rule-based breakout), calibrate InpMaxSpreadPoints (10000 broker points is a placeholder), and run a
fresh backtest plus a demo.
