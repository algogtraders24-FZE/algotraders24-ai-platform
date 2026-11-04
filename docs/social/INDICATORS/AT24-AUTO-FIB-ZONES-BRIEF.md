# AT24 Auto Fib Zones - marketing brief (list item #10)

**Name:** AT24 Auto Fib Zones  **Tagline:** Fib levels on a confirmed swing - and what pullbacks really did.
**Platforms:** MT5 only for now. **Type:** context indicator, no signals. Strategy lesson: #10 Fibonacci retracement.
**Assets:** `ea-research/indicators/AT24_Auto_Fib_Zones/branding/` (logo, screenshot_mt5.png).

## What it solves
Hand-drawn fibs are subjective and move with the drawer's choice of swing. The indicator finds swings by a fixed rule (confirmed, no repaint), draws 0 / 23.6 / 38.2 / 50 / 61.8 / 78.6 / 100 % on the last leg with the 38.2-61.8 zone shaded, shows how deep price has pulled back, and measures on YOUR symbol how deep pullbacks really went and how often the leg's extreme was beaten.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (782 legs): median pullback 97 % of the leg; 48.5 % went past 100 %; legs resumed beyond their extreme 48 % of the time.
- Pullback depths do not cluster at fib levels more than at other values (control test): fib levels are a reference grid, not magic numbers.
- Maths verified against an independent Python calculation (all swings and statistics identical). No repaint: closed bars only.
- Never prints buy/sell arrows.

## Claims you must NOT make
- No "price reacts at 61.8", "golden zone entry" or any edge/win rate. The 66 % "shallow then resumed" figure is circular; do not advertise it.
- Swings depend on the chosen swing size; other settings give other legs and numbers.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
