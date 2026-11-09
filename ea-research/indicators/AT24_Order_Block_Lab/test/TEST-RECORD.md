# AT24 Order Block Lab - test record (2026-11-09, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_OB_SelfTest.mq5` + `test/verify_ob.py`, 20,000 XAUUSD H1 bars) | all 1,272 blocks identical (block bar, confirming bar, direction, zone, ATR, first-touch bar, control-touch bar, reaction and control reaction); every statistic identical |
| MT5 live chart (portable terminal, XAUUSD M15) | untouched zones drawn to the right, nearest blocks above/below, statistics with n and 95 % intervals: test/mt5_order_block_lab_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Definition (own, stated openly)
- Bullish block: the last DOWN candle before an up move in which a bar close within the next 3 bars is at least 1.0 ATR(14) above that candle's high. Bearish block: the mirror. Zone = the candle's high-low range. One block per move (no new block within 3 bars of the previous). A block exists only from the bar that confirms the move (no repaint).
- Touch: a later bar's range reaches the zone edge (within 100 bars for the statistics). Reaction (judged over 24 bars after the first touch): the close moves 0.5 ATR away from the zone, in the direction the block "should" react, before closing 0.5 ATR beyond it.
- Control: the same block mirrored through the confirming close (price approaches it from the other side), with the same touch and reaction rules.

## Real result on one broker feed (XAUUSD H1, 20,000 bars, 1,261 blocks with a full follow-up)
| | order block | mirrored control zone |
|---|---|---|
| Price came back within 100 bars | 81.2 % | 80.5 % |
| Reacted (of decided touches) | 50.5 % (n = 1,024) | 51.3 % (n = 1,015) |

The indicator's own run on 8,000 M15 bars gives the same picture (443 blocks: came back 82 % vs 85 %; reacted 49 % (+-5, n = 362) vs 53 % (+-5, n = 375)). On both timeframes the "order block" behaves exactly like a zone at the same distance on the other side of price: no demonstrable order-block effect. Descriptive only.

## Notes / limits
- Other definitions of an order block (wick/body zones, structure-break requirements, higher-timeframe context) were not tested; the finding applies to this definition. Parameters (1.0 ATR, 100 bars, 24 bars, 0.5 ATR) were fixed before looking at the result.
- Overlapping blocks share future bars, so the +-95 % interval is optimistic.
- The dashboard's "untouched" count scans every bar up to the last closed bar (not only the statistics window). Alerts (new block) not exercised beyond a compile.
