AT24 HOURLY RANGE HEATMAP v1.01 (MT5, licensed utility EA)

WHAT IT SHOWS
- The average H1 range for each of the 24 hours of the day on the chart symbol, as a heatmap (current hour outlined).
- The 3 busiest and 3 quietest hours, how many times bigger the busiest hour is than the quietest, and this hour's range so far against the usual full hour.
- Hours are your BROKER's clock. Use the input "Show hour labels shifted by" to read them in your own time.
- Uses the last 60 trading days of completed H1 bars (input: days of history).

WHAT WE TESTED (honest summary)
- Compiled with 0 errors and 0 warnings and run on a real MT5 XAUUSD M15 chart (IC Markets demo data).
- Example from the screenshot in the listing (about 61 trading days of that feed): busiest hours 15:00-17:00 broker time, quietest 23:00, 07:00 and 01:00, busiest hour about 3.1x the quietest. These are past averages on one broker feed and will differ by broker, symbol and period.
- A busy hour is not a good trade by itself: more range also means more risk and often wider spreads. This is not a "best time to trade" tool.
- Not tested: live-money use, other symbols beyond XAUUSD.

INSTALL (MetaTrader 5) - this product is a licensed UTILITY EXPERT ADVISOR
It draws on your chart and never places or modifies orders. It is an Expert Advisor only because MetaTrader does not let indicators check a licence online.
1. In MT5 choose File > Open Data Folder, open MQL5 > Experts and copy AT24_HourlyRangeHeatmap_Licensed.ex5 into it.
2. In the Navigator panel right-click Expert Advisors > Refresh.
3. Allow the licence check once per terminal: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add https://www.algotraders24.ai
4. Drag AT24_HourlyRangeHeatmap_Licensed from Navigator > Expert Advisors onto a chart (any symbol with history). On the Inputs tab paste your licence key into "InpLicenseKey" (from your AT24 dashboard: Dashboard > Purchases > your product).
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
