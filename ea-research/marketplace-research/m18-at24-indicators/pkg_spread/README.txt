AT24 SPREAD BY HOUR v1.00 (MT5)

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

INSTALL (MetaTrader 5)
1. In MT5 choose File > Open Data Folder, open MQL5 > Indicators.
2. Copy AT24_SpreadByHour.ex5 into that folder.
3. In the Navigator panel right-click Indicators > Refresh.
4. Drag AT24 Spread by Hour from the Navigator onto any chart (any symbol with history).
5. The AT24 dashboard appears top-left. Inputs can be changed with the F7 key / Inputs tab.

The indicator does not trade, does not place orders, uses no DLL and no web access.
The dashboard is switched off inside the Strategy Tester unless you enable it (input: Strategy Tester dashboard) and run in visual mode.

IMPORTANT
- Education tool, not a signal. Nothing here is investment advice and nothing predicts future price.
- Personal use on your own charts. Please do not redistribute the file.
- Support: support@algotraders24.ai
