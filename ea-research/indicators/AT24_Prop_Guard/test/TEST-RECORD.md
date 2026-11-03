# AT24 Prop Guard - test record (2026-11-02)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 self-test script (`mt5/AT24_PropGuard_SelfTest.mq5`) on a live demo account | 22 / 22 PASS: 10 synthetic scenarios (limits, breach, profit, total loss, target progress, status levels, day-key and day-start for a 17:00 reset) + indicator buffers vs independent calculation (daily/total used %, daily/total left $, open risk) |
| MT5 live chart screenshot | dashboard with logo, two gauges, left-today/left-overall, open risk, target, day-start line: test/mt5_prop_guard_chart.png |
| MT4 compile | 0 errors, 0 warnings |
| MT4 runtime (Exness demo, test EA reading the indicator through iCustom) | 6 / 6 PASS (account connected, daily left $, total left $, daily used %, total used %, open risk $) |
| TradingView Pine v5 | "Compiled. Added to chart." in the Pine editor; dashboard renders; sample numbers check by hand (100k account, 5% daily = 5,000, 0.5% risk = 500, 10 full losses to the limit): branding/screenshot_tradingview.jpg |

## Bugs found and fixed
1. At terminal start the account data was not loaded yet (balance 0) and the indicator stored 0 as the initial balance permanently. Fixed: it now shows "WAITING FOR ACCOUNT DATA", never stores or shows zeros, and only stores the initial balance once a real balance exists.
2. Footer text was clipped on the dashboard; shortened.
3. (Test mistake, not a code bug) one self-test expectation for target progress was wrong; corrected.

## NOT verified (be honest in marketing)
- Open risk with real open positions: the test accounts had no open trades, so only the 0-position case was compared. The loop uses OrderCalcProfit (MT5) / tick value (MT4); a test with a live demo trade is still to do.
- Day start by "balance at reset" is rebuilt from deal history; "equity when first seen" depends on when the indicator was first attached that day.
- Prop firms differ (daily loss base, reset time zone, trailing rules). The tool uses the limits the user types and does not connect to any firm.
- TradingView edition cannot read the account: it is a calculator driven by typed numbers.
