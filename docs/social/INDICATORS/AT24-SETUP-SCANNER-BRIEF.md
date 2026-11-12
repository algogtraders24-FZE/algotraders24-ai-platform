# AT24 Setup Scanner - marketing brief (own product)

**Name:** AT24 Setup Scanner  **Tagline:** Your watchlist in one table: who has a setup now, and who has earned the right to be trusted.
**Platforms:** MT5 only for now. **Type:** multi-symbol setup scanner + scorecards; places no trades.
**Assets:** `ea-research/indicators/AT24_Setup_Scanner/branding/` (logo, screenshot_mt5.png; the screenshot includes a custom TEST symbol BTCUSD_T built from public Binance data, retake it with broker symbols before use).

## What it solves
Scanning many symbols by eye is slow, and scanners that only show arrows hide how often the same setup failed on each symbol. The Setup Scanner shows, for up to 20 symbols, the trend, any setup on the last closed bar with entry, stop and target, and each setup type's record on that symbol's own history in R after cost with a luck test. A chance line tells how many "passes" luck alone would give across the list.

## Honest claims you MAY make
- Non-repainting (closed bars only); levels shown before the trade; every setup type is scored per symbol with a luck test; a multiple-testing reminder is built in; the engine is verified against an independent Python calculation on two symbols.
- On our test feeds almost every scorecard showed no edge: the scanner is honest, not a promise of winners.

## Claims you must NOT make
- No profit, win-rate or accuracy claims; no "signals"; a PASS is in-sample and may be luck (the panel says so). Past results do not predict future results.
- No setup logic in listing copy; first sentence 70-155 characters; title <= 40 characters.
- Live setups and alerts are not yet verified on a connected terminal (see the test record); symbol names must match the broker's.

## Footer text
"Research and planning tool, not a signal or a forecast. No trades are placed. Past results do not predict future results. Not financial advice. algotraders24.ai"
