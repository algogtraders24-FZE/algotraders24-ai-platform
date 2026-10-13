# SMC structure engine (port of the owner's "AT24 SMC AI Engine" indicator)

`services/smc/smc-engine.ts` (pure), `services/smc/smc-service.ts` (candles + cache),
`services/evidence-sources/smc-evidence-source.ts` (evidence). Test: `npm run validate:smc-engine` (18).

## What it does
On Exness MT5 candles (chart timeframe 1h, higher timeframe 4h): swings (5-bar fractals), BOS / MSS (close through the
protected high / low; "weak" when the break is under 0.5 ATR), 4h bias, liquidity pools (EQH/EQL from swings, PDH/PDL and
PWH/PWL from the previous day / week) with untouched / tested / swept status and sweep detection (wick through the level, close
back, reclaim >= 0.5 ATR), order blocks (last opposite candle before a displacement of >= 0.6 ATR in the bias direction), fair
value gaps (three-candle imbalance >= 0.15 ATR), mitigation (OB 50%, FVG 100%), premium / discount of the swing range,
volatility regime (ATR vs its 49-bar average) and the owner's v2 structure score (HTF alignment 25(+3), fresh sweep 22,
structure event 20, order block 15, FVG 10, premium/discount 8, volatility 5, normalised to 0-100).

## What it feeds
* **Evidence**: `technical` evidence under ONE source name ("AT24 SMC structure"): structure + 4h bias, a fresh sweep, nearest
  unswept liquidity, the active OB / FVG, location, volatility, and one summary line with the structure lean and score.
  Evidence coverage on the Signals cards goes 4 -> 5 of 8 types.
* **Signals cards**: "SMC structure: bullish-leaning (developing) - 68/100 - 4h bullish".
* The lean is `bullish-leaning` / `bearish-leaning` / `none` (aligned with the 4h bias and score >= 55 developing / >= 70 strong).

## What is deliberately NOT ported
The indicator's `BUY SETUP` / `SELL SETUP` status and its entry / stop-loss / take-profit lines. AT24 never issues a trade
signal or target; the lean is a structure summary. Every consumer labels the score "rule-based structure with unvalidated
weights, not a trade signal". The weights are the owner's heuristic - they have not been tested against outcomes (a
validation of the score vs forward price behaviour is a separate piece of research).

## Differences from the MQL5 original (bugs fixed in the port)
1. **Swing detection froze after the first scan**: `ScanBar(1, ...)` can never satisfy `i - L >= 0` (L = 5), so after load only
   the structure check ran, against stale protected levels. The port confirms swings L bars later on every call.
2. **Sweeps were only ever checked on the newest bar**, and a sweep's time was `TimeCurrent()` (so all history looked "fresh" and
   the 12-bar expiry meant nothing). Now every bar is scanned and a sweep is timed by its own candle; expiry is by bar count.
3. **A new FVG was marked "tested" by its own candle** (the third candle touches the zone edge). Zones are only mitigation-checked
   from the bar after they form.
4. **Zone expiry used wall-clock** (`TimeCurrent() - bars * period`), which is wrong over weekends; now by bar count.
5. **Score denominator excluded the +3 MSS bonus**, so the raw score could pass 100 before the clamp; the denominator now includes it.
6. **No look-ahead**: structure at bar t only uses swings confirmed by t (test: events up to bar P are identical with or
   without later candles). The MQL5 historical scan registered a swing at its own bar.
7. ATR is a simple moving average of the true range (MT5's iATR), computed per bar (the indicator used the latest ATR for the
   whole history).
8. The forming candle is excluded; it only supplies the live price. Previous-day / week levels are derived from the 1h candles
   by UTC date (Exness servers run on UTC).

## Limits
Needs ~34+ closed candles; fewer -> no analysis (evidence absent, never estimated). 4h data is optional (without it the 4h bias is
Neutral and the HTF alignment points are 0). Candles come from the shared market-data service (MT5 first, Twelve Data fallback).
