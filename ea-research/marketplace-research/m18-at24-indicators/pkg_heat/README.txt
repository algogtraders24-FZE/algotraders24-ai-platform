AT24 HOURLY RANGE HEATMAP v1.00 (MT5)

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

INSTALL (MetaTrader 5)
1. In MT5 choose File > Open Data Folder, open MQL5 > Indicators.
2. Copy AT24_HourlyRangeHeatmap.ex5 into that folder.
3. In the Navigator panel right-click Indicators > Refresh.
4. Drag AT24 Hourly Range Heatmap from the Navigator onto any chart (any symbol with history).
5. The AT24 dashboard appears top-left. Inputs can be changed with the F7 key / Inputs tab.

The indicator does not trade, does not place orders, uses no DLL and no web access.
The dashboard is switched off inside the Strategy Tester unless you enable it (input: Strategy Tester dashboard) and run in visual mode.

IMPORTANT
- Education tool, not a signal. Nothing here is investment advice and nothing predicts future price.
- Personal use on your own charts. Please do not redistribute the file.
- Support: support@algotraders24.ai
