# AT24 Position Map - test record (2026-11-17, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, core, self-test, unit test, screenshot script) |
| Hand-worked unit tests (`mt5/AT24_PM_UnitTest.mq5`, answers worked out on paper first) | 29 of 29 pass: ATR(14); swings found in order with price, bar and confirm bar; a swing is NOT visible before its confirm bar; trend up from HH + HL and range before two highs and two lows exist; a WICK below the higher low does not end the trend, a CLOSE below it does; equal highs are not a swing; an outside bar is skipped; a higher high replaces the previous high (marked at the confirming bar); stop and target in one bar = stop (long and short mirror); target alone paid at the target price; 8-week time stop at the close with 56 days of swap; an unfinished trade stays open; the whole entry rule on one hand-built scenario (long): trigger bar, entry = next open, pullback low P, B, stop = P - 0.25 ATR(H4), targets entry + 3, 4, 5 R, still open; a bar reaching target 1 pays +3 R and leaves 2 and 3 open; a bar below the stop ends all three at -1 R; a 50 % pullback is rejected when 60 % is required; the mirrored market gives exactly one short at the same bars with mirrored levels |
| Engine vs independent Python (`mt5/AT24_PM_SelfTest.mq5` + `test/verify_pm.py`, real XAUUSD bars: 473 W1, 2,657 D1, 9,000 H4) | everything identical: 103 W1, 239 D1 and 1,538 H4 swings (bar, confirm bar, type, price, replaced-at, first close beyond); the trend at every W1 and D1 bar; all 27 setups with every field (direction, trigger bar, entry bar, entry, stop, risk, pullback, B, three targets, and per target the exit status, exit bar, result in R and the control in R); the scorecard of all three targets and of the control (n, wins, hit, average R, total R, t, sign-flip p); the trend-life statistics. The Python rebuilds the swings bar by bar as time advances (a chain that drops a swing when a more extreme one confirms), the MQL5 side precomputes them with confirm and replaced bars, so the two are built differently. |
| No look-ahead | the same rules run on a history cut at 35, 50, 65, 80 and 92 percent give the same setups at the same bars with the same levels (11, 16, 18, 20, 24 setups before each cut); the weekly trend at every 9th bar is the same when only the bars up to it exist |
| MT5 live chart (portable terminal, XAUUSD H4) | dashboard, stage line, plan, three scorecards, trend life, weekly swing arrows and levels, pullback zone, entry line: test/mt5_position_map_chart.png. Buffers read through iCustom: weekly trend -1, stage 3, live plan short with entry, stop and three targets. |
| Non-repainting | swings are used k bars after they formed, trend breaks need a CLOSE, every bar used is closed (CopyRates from shift 1); the history is rebuilt once per new H4 bar |
| Alerts (new trigger, weekly trend change), push | code paths written, NOT exercised: no trigger formed on the last bar of the test chart and the offline terminal has no weekly close to cross. Needs a look on a live chart. |
| Lot size and swap | lot size uses the symbol tick value and shows the minimum lot on the offline demo; the swap of the offline symbol is 0, so the swap cost path was not exercised with real numbers. Needs a live account check. |
| MT4 / TradingView / scanner | not built |

## What it does
The weekly structure gives the only direction: higher highs and higher lows (up), lower highs and lower lows (down), anything else is a range and means no trade. A pullback of at least 38.2 % of the last weekly leg is measured; an H4 higher low (lower high for a short) followed by an H4 close beyond the last counter swing is the trigger; the entry is the next H4 open, the stop is beyond the pullback extreme plus 0.25 ATR(H4), and the three targets are 1:3, 1:4 and 1:5 of that risk. Every setup the rules would have produced in the loaded history is walked forward on the real bars (stop first if both are hit in one bar, 8-week time stop, cost = spread plus broker swap) and scored per target with a sign-flip luck test and a control traded the other way. A trend-life block shows how long weekly legs last on the symbol and how deep pullbacks go. Exact rules: SPEC.md.

## Real result on one broker feed (XAUUSD, self-test: 9,000 H4 bars = about 6 years)
27 setups (26 resolved). Target 1:3: hit 58 % (profitable exits), average +0.71 R, total +18 R, sign-flip p 0.029; target 1:4: +0.61 R, p 0.058; target 1:5: +0.54 R, p 0.078. The same trades traded the other way: -0.46 R, -0.62 R, -0.62 R. On the indicator's default 7,000 H4 bars: 20 setups, 1:3 +1.06 R, 1:4 +0.94 R, 1:5 +0.84 R. Of the 26 resolved trades at 1:3, 9 reached the target, 8 hit the stop and 9 ended by the 8-week time stop (mostly in profit).

**What this does and does not say.** Fewer than 30 setups, so the indicator itself prints "too few setups" and makes no claim. It is in-sample on one feed over a period in which gold rose strongly. The profit comes largely from the time-stop exits in a trend, not from the targets. The rules have several parameters and one rule (the target) was changed after the first run (see SPEC.md), so a scorecard that looks good here is not evidence. Our earlier tests of pullbacks, zones and structure labels found no edge.

## Bugs found while testing
1. The first target rule (nearest weekly or daily swing beyond the entry) produced 117 of 129 triggers with a reward below 2R (median 0.14R) because minor daily swings sit next to the entry. Replaced by fixed 1:3, 1:4, 1:5 targets (SPEC 5.5).
2. First screenshot: dashboard lines were cut at about 58 characters (MT5 label limit) and the stage line was missing because the chart objects drawn with the prefix `s` deleted the dashboard labels `s1`, `s2`. Lines shortened, past-setup lines renamed `ps`, past-setup lines drawn behind the dashboard.
3. A new trigger cannot appear while a plan is running (one setup at a time per side, busy until all three targets are done); the stage line now says so instead of showing a trigger that would not be taken.

## Notes / limits
- Swings are known k bars late by design (W1 2, H4 3). A trend defined by two swings flips in choppy markets, which is why RANGE means no trade.
- The structural stop is wide on a weekly pullback (the dashboard shows the risk in weekly ATR and flags WIDE above 2.5); the lot size shrinks accordingly.
- Both-in-one-bar is counted as a stop; gaps and slippage are not modelled; the cost is the spread plus the swap.
- Dashboard off in the Strategy Tester by default. Buffers (iCustom): 0 weekly trend, 1 stage (0-4), 2 live plan direction, 3 entry, 4 stop, 5-7 targets; the parameter list in iCustom counts each `input group` header as a slot.

## Position Scanner (multi-symbol table, same core)
- The Scanner includes `AT24_PM_Core.mqh` unchanged: no new maths, one symbol is rebuilt per 1 s timer tick and again on each new H4 bar.
- Compiled 0 errors, 0 warnings. Offline terminal, 4 of 5 symbols had data.
- Row equality with Position Map on the same bars: XAUUSD (W1 DOWN, short plan running, entry 4091.59, stop 4703.22, TP1 2256.70, 3.0 wk ATR, +1.06 R (19)) and EURUSD (entry 1.13412, stop 1.17164, TP1 1.02157, 2.9 wk ATR, +0.22 R (15)) are identical to the Map. GBPUSD and USDJPY show RANGE (no trade). US30 shows "no data / symbol not found" (not in the offline terminal).
- Build time 63-110 ms per symbol.
- NOT exercised live: alerts (trigger / turn / push), real-account swap and lots, symbols missing in the offline terminal.
- Record column is the same-rules average R on that symbol's own H4 history; under 30 setups nothing is claimed.
