# Day 1b: control test for Iron Stops (random entries, same geometry)

Why: Iron Stops returned +69% in 9 months at 81% win rate. Is that its entry timing, or just the trade geometry (SL about 3.8 ATR, TP about 2.6 ATR, 36 h hold) plus a strong gold period?

Control EA: `ea-research/lab/AT24_Lab_GeometryBaseline.mq5` (our own code, research only, not a product; not a copy of Iron Stops). Same terminal (Exness demo), XAUUSD 24/7 symbol, M30, 2026-01-01..2026-10-09, 1-minute OHLC, $10,000, risk 1% per trade, about 65-72 entries (probability per bar 0.8%, max 2 per day).

| Run | Net | PF | Win % | Max equity DD | Avg win / loss |
|---|---|---|---|---|---|
| random seed 1 | -1,134 | 0.53 | 40.0 | 13.3% | 49 / -62 |
| random seed 2 | +548 | 1.33 | 63.9 | 5.1% | 48 / -64 |
| random seed 3 | -192 | 0.90 | 58.2 | 6.4% | 46 / -70 |
| trend-side (EMA50) | -350 | 0.82 | 50.8 | 4.6% | 49 / -62 |
| **Iron Stops** | **+6,937** | **4.45** | **81.3** | **4.5%** | 147 / -142 |

Reading:
- With this geometry the break-even win rate is about 59%. Random entries land at 40-64% (mean about 54%) and about break-even to negative, with large seed-to-seed spread.
- Iron Stops: 61 wins of 75 (81%) is far outside what random entries give with this geometry (rough z-score about 4.8). In units of its average loss it made about +49R versus -18R, +9R, -3R for the random seeds.
- So the edge is in the entry timing, not in the geometry or the gold regime alone.

Caveats: 75 trades is below the 300-trade gate; 1-minute OHLC only; one window with 40 of 75 trades in Aug-Sep; Iron Stops' lot/risk scaling differs (average loss 1.4% of balance vs 0.6% in the control), the +49R figure normalises that; the EA may be tuned to this period (in-sample). Simple features on the M30 signal bar (volume ratio, 10/20-bar breakout, candle direction, EMA50 side) did NOT discriminate its entries from the base rate, so the trigger is something else (maybe lower-timeframe volume or intrabar).

Next (max 2 tests): real-ticks run of the same window, then 2025-H2 on the same terminal. If both keep the edge, search for the trigger on M1/M5 features; if not, stop.
