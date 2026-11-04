# AT24 Drawdown & Recovery - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_DD_SelfTest.mq5` + `test/verify_dd.py`) | recovery table (1 %..99 %), losing-streak table (0.5 / 1 / 2 / 5 % risk x 1 / 5 / 10 / 20 losses) and "losses in a row to reach -10 / -20 / -50 %" identical; three deterministic synthetic P/L series (400, 550, 700 deals, drifting win rates, floating loss) identical for peak, maximum drawdown, current drawdown, gain needed, equity, deals since peak |
| MT5 live chart (portable terminal with a demo account history, XAUUSD M15) | 80 deals read from the account history: equity 7,822.44, peak 12,837.95, 39.1 % below peak, +64.1 % needed (7,822.44 / 12,837.95 = 0.609, 1 / 0.609 - 1 = 64.1 %) - arithmetic checked by hand; table and streak rows on screen: test/mt5_drawdown_recovery_chart.png |
| Not cross-checked | the equity curve rebuilt from the deal history was not compared with a broker statement or Myfxbook; deposits/withdrawals are assumed to be made at the start (balance operations are skipped), so accounts with later deposits can show a different drawdown than the broker |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Notes / limits
- Gain needed = d / (1 - d): a 50 % loss needs +100 %, a 75 % loss +300 %. After n losses of r % of the current balance the drawdown is 1 - (1 - r)^n. These are exact arithmetic, not forecasts.
- Current drawdown includes floating profit/loss; the peak is the highest point of the rebuilt curve including today's equity.
- Optional magic-number filter counts only those deals; the other results stay in the base, so the curve is "this strategy's results on top of the account".
- No account connected: the panel shows only the formula tables and says so. The screenshot shows a demo account; swap it for a neutral one before marketing use if you prefer.
