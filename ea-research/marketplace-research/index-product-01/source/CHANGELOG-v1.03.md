# AT24 Index Breakout v1.03 (from "XXX Multi-Index v1.02")

Source of v1.02: pasted by the owner on 2026-10-12. v1.03 compiles with MetaEditor64: **0 errors, 0 warnings**.
**Not yet run in the Strategy Tester or on a demo.** Treat any v1.02 backtest or live record as describing v1.02 only.

## Fixes
| # | Problem in v1.02 | v1.03 |
|---|---|---|
| 1 | `HistorySelect()` never called, so the deal history was not loaded. Dashboard stats were empty or partial and `InpMaxTradesPerDay` was effectively never enforced. | History is selected before every read. Trade stats are recalculated only when a deal is added (not every second). Daily count reads today's history only. |
| 2 | "Profit factor" was net profit / number of losing trades. | Gross profit / gross loss; shows `n/a` while there are no losses. |
| 3 | Every new bar placed 3 modules x 2 sides of new pending orders next to the old ones (30 minute life), and nothing stopped a module adding to its own open trade. Lot size could triple or more. | One order per module and side: last bar's order is replaced, not stacked. A module places nothing while its own trade is open (`InpOneTradePerModule`). `InpMaxOpenPositions` (default 3) caps open positions. |
| 4 | Prop mode measured profit target and max drawdown from **today's** starting equity (reset daily), the daily-loss limit only worked with prop mode OFF, and every pause (even a prop lock) cleared at the next day. | Measured from the **start balance** (`InpPropStartBalance`, or the balance at first start, remembered per account). Daily-loss limit works with or without prop mode. A prop lock stays until the EA is re-attached; a daily-loss pause ends with the day; the manual PAUSE stays until RESUME. |
| 5 | Distances were `points x broker point`, so 120 "points" is 120 index points on a broker whose point is 1.0 but 1.2 on a broker whose point is 0.01. | `InpPointMode = PM_INDEX` (default): 1.0 = one index point on every broker. `PM_BROKER` restores the old behaviour. OnInit prints the real price distances and warns if the stop is under 3x the spread. Spread shield stays in broker points. |
| 6 | Lot not normalised to the broker's min/max/step; no margin check. | `NormalizeLot()`; orders that need more than 90% of free margin are skipped with a log line. |
| 7 | Eclipse read the fractal buffer at one bar only; the indicator leaves `EMPTY_VALUE` on bars without a fractal, so it rarely (or wrongly) traded. | Eclipse uses the most recent real fractal in the last 60 bars. |
| 8 | No licence check at all (anyone could copy the file; nothing ended at the 12-month expiry). | AT24 licence guard (same mechanism as the other AT24 EAs): activate on start, re-validate every `InpLicenseRecheckHours`, no new trades if invalid, existing positions still managed; skipped inside the Strategy Tester. |
| 9 | `#property strict` (MQL4), fixed IOC fill type, never-cleaned trade-lock array, `PositionGetInteger` without selection, stop-level not checked on SL changes, dashboard showed "AI: REMOVED". | `CTrade.SetTypeFillingBySymbol`, stale locks cleaned, `posInfo.Time()`, stop-level checked before every SL change, "LIC" status instead of the AI label. |

## Behaviour that changed on purpose (so old results do not carry over)
Fix 3 (fewer stacked orders), fix 5 (distances on brokers whose point is not 1.0) and fix 7 (Eclipse trades more) change what the EA does. Fix 4 changes when prop mode stops. Run a fresh backtest and a demo before this is sold, and publish only that evidence.

## Before it is sold
- `AT24_TRADING_SYSTEM_ID` and `AT24_VERSION_ID` at the top of the file are placeholders (`INDEX-BREAKOUT`, `INDEX-BREAKOUT-v1.03`). They must equal the TradingSystem and Version registered for the listing, or the licence check will reject every buyer.
- The buyer must add `https://www.algotraders24.ai` under Tools > Options > Expert Advisors > Allow WebRequest.
- Deliver the compiled `.ex5` only, never the `.mq5`.
- Naming: the file no longer says "AI" anywhere because the logic is rule-based (breakout + EMA trend filter). Do not market it as AI.
- MoonLock closes a trade as soon as profit falls to 50% of its peak (once it has made 1.0 in account currency). That keeps wins small by design; check it in the new backtest.

## One-key licence option (added after the first v1.03 commit)
New input InpLicenseKey: paste the single key (AT24-...) from the purchase page and leave the four alternative rows empty. The EA calls /api/license/check, which also binds the trading account, and then checks that the key belongs to THIS product (tradingSystemId and platform from the answer) so a key for another AT24 product cannot run this EA. A refusal stops new trades; a network or server problem keeps the last known state. The four-value mode still works.
Compiles with 0 errors, 0 warnings. Not tested against the live server (needs a real licence).
