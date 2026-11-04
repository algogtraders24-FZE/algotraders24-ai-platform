# AT24 Prop Guardian - marketing brief (protection EA, companion of Prop Guard)

**Name:** AT24 Prop Guardian  **Tagline:** Stops you before the limit stops your account.
**Platforms:** MT5 EA (places NO trades). **Type:** protection tool. Companion to the AT24 Prop Guard dashboard indicator.
**Assets:** `ea-research/indicators/AT24_Prop_Guardian/branding/` (logo, banner). Source: `.../mt5/AT24_Prop_Guardian.mq5` v1.01.

## What it does
You enter your daily loss %, max loss % and an optional daily profit lock. When 90 % (adjustable buffer) of a loss limit is used it closes all positions, deletes pending orders and blocks new ones until the next daily reset (daily/profit lock) or until you press UNLOCK (max-loss lock). New in 1.01: a runaway alert when another EA keeps re-opening trades while locked.

## Honest claims you MAY make
- It acts at your own limit minus a buffer and tells you when it locks; verified in the Strategy Tester: locks at the buffer, unlocks at the daily reset, removes trades opened while locked.
- It warns you when something keeps re-opening trades during a lock.
- Does not trade on its own; works with any EA or manual trading on the account.

## Claims you must NOT make
- No "prevents breaches", "guarantees" or "passes the challenge"; gaps, slippage and a stopped EA/VPS can still cause losses beyond a limit. Must run 24/5 (VPS).
- No firm names or affiliation; firm rules differ, the user sets the limits and reset hour.
- It cannot switch another EA off or disable AutoTrading; it can only close trades and alert.

## Footer text
"Protection tool, not a guarantee. Rules differ by firm; set your own limits. Not affiliated with any prop firm. Not financial advice. algotraders24.ai"
