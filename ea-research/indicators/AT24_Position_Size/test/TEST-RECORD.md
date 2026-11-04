# AT24 Position Size - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python with exact decimals (`mt5/AT24_PS_SelfTest.mq5` + `test/verify_ps.py`) | 10 synthetic cases identical (gold-like, 5-digit forex, non-USD tick value, index step 0.1, whole-lot step, exact multiple 0.30 not rounded down, below-minimum-lot flag, capped by maximum volume) and the real XAUUSD symbol (tick 0.01, tick value 1, contract 100, step 0.01): 200 USD risk, 12.5 stop -> 0.16 lots, 1,250 per lot |
| Platform cross-check | `OrderCalcProfit` returned 0 in the test terminal (no live broker connection) so the loss was NOT cross-checked against the platform here; the formula uses the symbol's own tick size and tick value, the same inputs the platform uses |
| MT5 live chart (portable terminal, XAUUSD M15, demo-number account 7,822 USD) | 0.07 lots for 1 % risk at a 10.00 stop (78.22 / 1,000 = 0.078 -> rounded DOWN), actual risk 70.00 = 0.89 %, stop/target ladder: test/mt5_position_size_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Notes / limits
- Lots are rounded DOWN to the volume step, so real risk is at or below the target; a minimum lot that risks more than the money available gives "MIN LOT RISKS TOO MUCH" and 0 lots.
- If the platform gives no tick value (no account connected) the indicator estimates it as tick size x contract size and labels it "(estimated)" in orange; correct only when the profit currency equals the account currency.
- Margin needs a connected account. Spread, slippage and gaps can make a real loss larger than the calculated stop loss. Calculator only: it never places or modifies trades.
- ATR stop mode uses closed bars only. Alerts none (calculator). Dashboard corner options not exercised beyond the screenshot.
