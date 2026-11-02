AT24 SPREAD BY HOUR v1.01 (MT5, licensed utility EA)

WHAT IT SHOWS
- The average spread (in points) for each of the 24 hours of the day on the chart symbol, read from your broker's TICK history (last 10 trading days by default), as a heatmap with the current hour outlined.
- The 3 widest and 3 tightest hours, widest versus tightest, and the spread right now against the usual spread for this hour.
- Hours are your BROKER's clock (input to shift the labels).
- The first load reads ticks from the broker and can take up to about a minute. It needs the broker's tick history for the symbol; if the broker does not provide it the dashboard says so instead of guessing.

WHAT WE TESTED (honest summary)
- Compiled with 0 errors and 0 warnings and run on a real MT5 XAUUSD M15 chart (IC Markets demo).
- Our first version read the spread stored in the H1 bar history and showed almost the same value for every hour while the live spread was three times higher, so this version uses tick data.
- Example from the listing screenshot (10 days, one broker): widest 23:00 broker time (about 14 points), tightest 18:00 (about 7 points). Other brokers and account types differ.
- It measures a cost, not an opportunity. Not tested: other symbols and brokers.

INSTALL (MetaTrader 5) - this product is a licensed UTILITY EXPERT ADVISOR
It draws on your chart and never places or modifies orders. It is an Expert Advisor only because MetaTrader does not let indicators check a licence online.
1. In MT5 choose File > Open Data Folder, open MQL5 > Experts and copy AT24_SpreadByHour_Licensed.ex5 into it.
2. In the Navigator panel right-click Expert Advisors > Refresh.
3. Allow the licence check once per terminal: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add https://www.algotraders24.ai
4. Drag AT24_SpreadByHour_Licensed from Navigator > Expert Advisors onto a chart (any symbol with tick history). On the Inputs tab paste your licence key into "InpLicenseKey" (from your AT24 dashboard: Dashboard > Purchases > your product).
5. Keep the Algo Trading button switched on so the EA can run. It does not trade. The dashboard appears top-left.

LICENCE
- One key works on ONE trading account at a time and only for this product. You can move it to another account yourself from Dashboard > Purchases (2 changes per 30 days).
- The only data sent to AT24 is your key, the trading account number, the broker server name and the product name. No trade data leaves your computer.
- The key is checked when the EA starts and every 4 hours. A short internet problem does not stop it (up to 72 hours).
- The Strategy Tester needs no key (the dashboard is off there unless you enable it and run in visual mode).

IMPORTANT
- Education tool, not a signal. Nothing here is investment advice and nothing predicts future price.
- Personal use on your own charts. Please do not share your key or the file.
- Support: support@algotraders24.ai
