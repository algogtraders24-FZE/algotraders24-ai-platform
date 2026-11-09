# AT24 Order Block Lab - marketing brief (new indicator)

**Name:** AT24 Order Block Lab  **Tagline:** Order blocks - do they work, or does any zone behave the same?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Order_Block_Lab/branding/` (logo, screenshot_mt5.png).

## What it solves
Order blocks are the most-shared smart-money concept and almost never tested. The indicator marks the zones (last opposite candle before a strong move) on closed bars while they are untouched, shows the nearest ones above and below price, and measures on YOUR symbol how often price came back and whether it reacted - against a control zone mirrored to the other side of price, with sample sizes and 95 % intervals.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD H1 test (1,261 blocks): price came back to the block 81 % of the time and reacted 50.5 % of the time; a mirrored control zone gave 80.5 % and 51.3 % - no difference.
- Blocks, touches, reactions and statistics verified against an independent Python calculation (all 1,272 blocks identical). No repaint: blocks exist only after the confirming bar closed.
- Clear about its definition; shows n and confidence intervals.

## Claims you must NOT make
- No "order blocks are high-probability zones", "institutional footprint" or win rates: on our definition they behave like any control zone. Other definitions were not tested.
- Results depend on the symbol, timeframe and parameters.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
