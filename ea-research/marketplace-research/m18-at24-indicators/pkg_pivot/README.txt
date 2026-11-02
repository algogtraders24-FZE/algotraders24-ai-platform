AT24 PIVOT LEVELS MAP v1.02 (MT5, licensed utility EA)

WHAT IT SHOWS
- Daily and weekly pivot levels (P, R1, R2, S1, S2). Monthly pivot, R3/S3 and Camarilla H3/H4/L3/L4 can be switched on in the inputs.
- The daily CPR (top and bottom of the central pivot range) and how wide it is compared with the last 20 days (NARROW / WIDE / normal, versus average only).
- Where price is now: above, inside or below the CPR, the nearest level above and below with the distance, and a table of all levels with the nearest one highlighted.
- Levels come from the previous completed day / week / month of your broker. Hours and days follow your broker's clock.

WHAT WE TESTED (honest summary)
- Compiled with 0 errors and 0 warnings and run on a real MT5 XAUUSD M15 chart.
- Descriptive study on XAUUSD M15 candles, 2024-11 to 2026-10: after the first daily touch of a pivot/CPR level, price bounced away 46.5%-47.1% of the time (bounce vs break, 4-hour look-ahead), against 49.1%-49.9% at randomly shifted placebo levels. We found no extra reaction at the levels on that data. Use them as a map of key prices, not as a signal.
- Narrow-CPR days were somewhat smaller on average (median day range 0.88x of the 20-day average vs 1.02x on wide-CPR days). That is descriptive only, not a forecast.
- Not tested: other symbols, other brokers, live-money use.

INPUTS (short)
Show daily / weekly / monthly levels, R3/S3, CPR, Camarilla, CPR average days, colours, line width, label size, dashboard position.

INSTALL (MetaTrader 5) - this product is a licensed UTILITY EXPERT ADVISOR
It draws on your chart and never places or modifies orders. It is an Expert Advisor only because MetaTrader does not let indicators check a licence online.
1. In MT5 choose File > Open Data Folder, open MQL5 > Experts and copy AT24_PivotLevelsMap_Licensed.ex5 into it.
2. In the Navigator panel right-click Expert Advisors > Refresh.
3. Allow the licence check once per terminal: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add https://www.algotraders24.ai
4. Drag AT24_PivotLevelsMap_Licensed from Navigator > Expert Advisors onto a chart (any symbol). On the Inputs tab paste your licence key into "InpLicenseKey" (from your AT24 dashboard: Dashboard > Purchases > your product).
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
