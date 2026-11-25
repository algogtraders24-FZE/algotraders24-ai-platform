# M12 reversal experiment (2026-10-09)

Question: does simply fading the PDH/PDL breakout (opposite direction) beat or complement the breakout?
Setup: AT24_M12_REVERSAL_EXPERIMENT.mq5 (copy of v2.11 + InpReverse/InpRevSL/InpRevTP), XAUUSD M15, 2025-01-02..2026-08-07, 1-minute OHLC model (screening only, NOT real ticks), Equiti demo data, $10k, 1:500, evidence-run inputs (fixed 0.10 lot, 2 trades/day, pyramid 0.5R, BE off, time filter off).

| Variant | Trades | Net | PF | Win % | Max equity DD |
|---|---|---|---|---|---|
| base breakout (SL 2.5x / TP 5x) | 1,461 | +19,152 | 1.14 | 37.7 | 47.4% |
| reversed, same SL/TP | 998 | -10,289 | 0.86 | 31.4 | 102.7% |
| reversed, SL 2.5x / TP 1.5x | 755 | -9,791 | 0.80 | 46.9 | 98.1% |
| reversed, SL 1.5x / TP 1.0x | 707 | +186 | 1.01 | 58.4 | 35.7% |

Findings:
- The base run on these settings lands close to the listed evidence (1,511 trades, PF 1.16, +21.7k): trades 1,461, PF 1.14, +19.2k. So the listed evidence settings reproduce on a different broker feed (equity DD differs: 47% here vs 34% listed; OHLC model).
- Inverting the breakout signal does NOT create an edge: best variant PF 1.01 (break-even), the others lose. Ship-gate (PF >= 1.3) fails.
- A real fade needs a different entry (failed-breakout confirmation, e.g. price closes back inside the prior-day range), not just an inverted direction. Not pursued here: hypothesis budget (3 variants) used.
