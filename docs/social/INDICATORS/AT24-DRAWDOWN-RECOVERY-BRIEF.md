# AT24 Drawdown & Recovery - marketing brief (risk tool R3)

**Name:** AT24 Drawdown & Recovery  **Tagline:** See how deep the hole is - and how much you need to climb out.
**Platforms:** MT5 only for now. **Type:** account tracker + calculator; places NO trades. Risk lesson: R3 drawdown and recovery.
**Assets:** `ea-research/indicators/AT24_Drawdown_Recovery/branding/` (logo, screenshot_mt5.png - shows a demo account).

## What it does
Reads your account's closed-deal history, rebuilds the performance curve, and shows: current drawdown below the peak (with floating P/L), the worst drawdown on record, the gain needed to get back (a 50 % loss needs +100 %), a recovery table (10 / 20 / 30 / 50 / 75 / 90 %), and a losing-streak table for your own risk per trade (how much 5 / 10 / 20 losses in a row cost and how many losses it takes to reach -10 % / -20 %).

## Honest claims you MAY make
- Exact arithmetic verified against an independent calculation (recovery table, streak table, three synthetic equity curves: all identical).
- Works on your own account history; places no trades.
- The recovery maths shows why protecting capital matters: -50 % needs +100 %.

## Claims you must NOT make
- Not a forecast and no "avoid drawdown" promise; losing streaks can be longer than the table's examples.
- The curve is rebuilt from deal history and assumes deposits/withdrawals at the start; it can differ from the broker's statement for accounts with later cash flows. Not cross-checked against a broker statement.

## Footer text
"Arithmetic on your own history, not a forecast. Not financial advice. algotraders24.ai"
