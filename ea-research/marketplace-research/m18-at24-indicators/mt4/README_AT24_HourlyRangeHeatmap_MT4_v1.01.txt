AT24 HOURLY RANGE HEATMAP - MetaTrader 4 version v1.01 (licensed utility EA)

WHAT IT SHOWS
- The average H1 range for each of the 24 hours of the day as a coloured heatmap, with the current hour outlined.
- The 3 busiest and 3 quietest hours, how many times bigger the busiest hour is than the quietest, and this hour's range so far against the usual full hour.
- Hours follow your broker's clock; an input shifts the labels to your own time. Uses the last 60 trading days of H1 bars.

INSTALL (MetaTrader 4) - this product is a licensed UTILITY EXPERT ADVISOR
It draws on your chart and never places or modifies orders. It is an Expert Advisor only because MetaTrader does not let indicators check a licence online.
1. In MT4 choose File > Open Data Folder, open MQL4 > Experts and copy AT24_HourlyRangeHeatmap_Licensed.ex4 into it.
2. Restart MT4 or right-click Expert Advisors in the Navigator > Refresh.
3. Allow the licence check once per terminal: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add https://www.algotraders24.ai
4. Drag AT24_HourlyRangeHeatmap_Licensed from Navigator > Expert Advisors onto a chart (any symbol with H1 history). On the Inputs tab paste your licence key into "InpLicenseKey" (AT24 dashboard: Dashboard > Purchases > your product).
5. Keep the AutoTrading button switched on so the EA can run. It does not trade. The dashboard appears top-left.

LICENCE
- One key works on ONE trading account at a time and only for this product (MT4 edition). You can move it to another account yourself from Dashboard > Purchases (2 changes per 30 days).
- The only data sent to AT24 is your key, the trading account number, the broker server name and the product name. No trade data leaves your computer.
- The key is checked when the EA starts and every 4 hours. A short internet problem does not stop it (up to 72 hours).
- The Strategy Tester needs no key (the dashboard is off there unless you enable it and run in visual mode).

WHAT WE TESTED (honest summary)
- Compiled with 0 errors and 0 warnings in MetaEditor 4 and run on a real MT4 XAUUSD M15 chart (Exness demo history). The busiest-versus-quietest ratio on XAUUSD matched our MT5 and TradingView versions (about 3 times).
- Not tested: live-money use, other symbols and brokers. Hours with too few bars show as empty; a busy hour is not a good trade by itself, so this is not a best-time-to-trade tool.

IMPORTANT
- Education tool, not a signal. Nothing here is investment advice and nothing predicts future price.
- Personal use on your own charts. Please do not share your key or the file.
- Support: support@algotraders24.ai
