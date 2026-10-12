# AT24 BTC Breakout v1.03 (from XXX BTC-USD v1.02)

Same fixes as the Index build (see ../../index-product-01/source/CHANGELOG-v1.03.md): HistorySelect, profit factor, no stacked orders,
prop-mode base balance, lot/margin checks, Eclipse fractal, AT24 licence guard. Fix 5 (point mode) is not needed: BTC distances were
already USD price units.

Compiles with MetaEditor64 (0 errors, 0 warnings). NOT run in the Strategy Tester or on a demo. v1.02 evidence does not apply
(fixes 3 and 7 change behaviour).

Before it is sold: set AT24_TRADING_SYSTEM_ID / AT24_VERSION_ID to the registered ids, allow the AT24 URL for WebRequest, deliver the
.ex5 only, do not market it as AI (rule-based breakout), calibrate InpMaxSpreadPoints (10000 broker points is a placeholder), and run a
fresh backtest plus a demo.

## One-key licence option (added after the first v1.03 commit)
New input InpLicenseKey: paste the single key (AT24-...) from the purchase page and leave the four alternative rows empty. The EA calls /api/license/check, which also binds the trading account, and then checks that the key belongs to THIS product (tradingSystemId and platform from the answer) so a key for another AT24 product cannot run this EA. A refusal stops new trades; a network or server problem keeps the last known state. The four-value mode still works.
Compiles with 0 errors, 0 warnings. Not tested against the live server (needs a real licence).
