# AT24 Daily Risk Panel - marketing brief (risk tool R2)

**Name:** AT24 Daily Risk Panel  **Tagline:** Your own daily rules, counted - not just written down.
**Platforms:** MT5 only for now. **Type:** tracker; only watches and warns, never closes or blocks trades. Risk lesson: R2 daily risk discipline.
**Assets:** `ea-research/indicators/AT24_Daily_Risk_Panel/branding/` (logo, screenshot_mt5.png - quiet day on a demo account).

## What it does
You enter your own rules: daily loss limit %, max risk per trade %, max total open risk %, max trades per day. The panel shows today's loss as a share of your limit (green to red gauge), trades opened, the risk of open positions to their stops, positions without a stop, and a "rules broken today" counter with the last break. Each broken rule is counted once per day and alerts once.

## Honest claims you MAY make
- Core arithmetic verified against an independent calculation on six scenarios (all identical).
- It is YOUR rule list: the panel enforces nothing, it makes slips visible.
- Pairs with AT24 Prop Guard / Prop Guardian for firm-style limits.

## Claims you must NOT make
- Not a prop-firm rule checker and not a guarantee you stay within any limit; it never closes or blocks trades.
- Live behaviour with open positions, alerts and the rule counter was verified through the core only; confirm on a connected demo before relying on it.
- No profit claims; not financial advice.

## Footer text
"Your own rules, tracked. Not a guarantee or advice. Check your broker statement for official figures. algotraders24.ai"
