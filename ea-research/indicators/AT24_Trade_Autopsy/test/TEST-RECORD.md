# AT24 Trade Autopsy - test record (2026-11-11, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_TA_SelfTest.mq5` + `test/verify_ta.py`) | 150 deterministic synthetic trades (random entries, lengths 1-40 bars, both directions, 75 % with a stop) on 30,000 real XAUUSD M15 bars: per trade move, MFE, MAE, post-exit move and R identical (150 of 150 rows); summary (trades, winners, losers, winner capture, give-back %, early-exit %, loser recovery %, winner heat %, average R, trades with stop) identical |
| MT5 live chart (portable terminal) | headline, exits / pain / risk blocks and the drawn trades on the built-in SAMPLE trades (labelled in red): test/mt5_trade_autopsy_chart.png |
| Deal pairing from account history (`HistorySelect`, position id, entry order stop-loss) | Verified by the Engineering window (2026-11-12) on a real MT5 demo account history (XAUUSD, M15, chart-symbol filter): 257 closed trades found (117 winners, 139 losers), full dashboard shown: winners kept 36 % of the best price, 77 % of winners saw price go at least as far again within 16 bars, 84 % of trades closed with under half of their best price, winners dipped 79 % of their best run against the position, 80 % of losers got back to entry within 16 bars, average -0.03 R over 255 trades with a stop. The drawn trades (last 30) were not visible in that screenshot because they are older than the visible bars: scroll back to see them (known behaviour, not a defect). |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
For each closed trade of the chart symbol (optionally one magic number / last N days), measured on bars of the chosen timeframe (default M15):
- MFE / MAE: best and worst price versus the entry during the trade; capture = result / MFE (winners); give-back = trades that closed with under half of their best price;
- winner heat: how far winners dipped against the position, as a share of their best run;
- post-exit: whether price went at least as far again within N bars after a winning exit ("early exit"), and whether a loser's price got back to the entry within N bars ("recovered");
- average R over trades that had a stop-loss at entry.
Closed trades are drawn on the chart (last N, green win / red loss).

## Notes / limits
- Bar granularity: the entry and exit bars include price before the entry / after the exit within that bar, so MFE/MAE are slightly generous; use M1 for tight measurements. Partial closes use the volume-weighted exit price; a trade whose stop was moved after entry shows R against the stop it had at entry.
- Hindsight statistics: they show what price did, not what the trader could have done; they do not say that holding longer would have been better on average. No profit claims.
- The SAMPLE mode is a labelled demonstration. Dashboard off in the Strategy Tester by default.
