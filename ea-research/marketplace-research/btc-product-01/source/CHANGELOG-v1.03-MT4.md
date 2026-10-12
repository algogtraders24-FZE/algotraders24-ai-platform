# AT24 BTC Breakout MT4 v1.03 (from XXX BTC-USD MT4 v1.02)

Compiles with the MT4 MetaEditor: 0 errors, 0 warnings. NOT run in the Strategy Tester or on a demo.
v1.02 evidence does not apply to this version (fixes 1, 3 and 7 change behaviour).

Same fixes as the Index MT4 build (see ../../index-product-01/source/CHANGELOG-v1.03-MT4.md):
1. MT4: the daily trade limit counted every closed order, including pending orders the EA deleted, and ignored the open trade. Now it counts market trades opened today.
2. Profit factor from gross profit / gross loss; lists and totals use only closed buy/sell trades.
3. One order per module and side, one trade per module, cap on open trades.
4. Prop mode from the start balance, persistent lock, independent daily-loss limit.
6. Lots normalised, free-margin check.
7. MT4: Eclipse needed an upper AND a lower fractal on the same single bar, so it almost never traded. Now the latest of each.
9. AT24 licence guard.
10. Stop-level checks before stop-loss changes; stale locks cleaned.
Not needed here: the point mode (BTC distances were already USD price units) and the Zenith bar count (this build already used 20).

Before it is sold: set AT24_TRADING_SYSTEM_ID / AT24_VERSION_ID to the registered ids (platform MT4 needs an MT4 release), allow the AT24 URL for WebRequest,
deliver the .ex4 only, calibrate InpMaxSpreadPoints (10000 broker points is a placeholder), set the Account History tab to All History,
do not market it as AI, and run a fresh backtest plus a demo.

## One-key licence option (added after the first v1.03 commit)
New input InpLicenseKey: paste the single key (AT24-...) from the purchase page and leave the four alternative rows empty. The EA calls /api/license/check, which also binds the trading account, and then checks that the key belongs to THIS product (tradingSystemId and platform from the answer) so a key for another AT24 product cannot run this EA. A refusal stops new trades; a network or server problem keeps the last known state. The four-value mode still works.
Compiles with 0 errors, 0 warnings. Not tested against the live server (needs a real licence).
