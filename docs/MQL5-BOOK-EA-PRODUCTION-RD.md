# MQL5 Book -> AT24 EA Production R&D

Date: 2026-10-07. Sources: mql5.com/en/book (Part 6 Trading Automation, Part 7 Advanced Tools) and the public channel t.me/mql5dev.
Scope note: derived from the book's chapter pages; code snippets below are the book's patterns, not yet compiled/tested in our EAs. Nothing here is implemented in product code.

## 1. Validation protocol (adopt as policy)

Tester tick modes (book: `tester_ticks`): Real ticks > Every tick > 1-min OHLC > Open prices.
- Open prices: SL/TP/pending fills can occur at a different price than requested.
- OHLC mode can produce deterministic patterns, i.e. "testing grails" that die live.
- Book's 3-stage hierarchy: rough optimization on OHLC/Open prices -> validate final settings on Every tick -> confirm on Real ticks.
- AT24 rule proposal: any "validated" claim for a marketplace EA requires a Real-ticks run; OHLC/Open-price results are never quoted as evidence.

## 2. OnTester custom criterion

```mql5
double OnTester()
{
   const double profit = TesterStatistics(STAT_PROFIT);
   return sign(profit) * sqrt(fabs(profit))
      * sqrt(TesterStatistics(STAT_PROFIT_FACTOR))
      * sqrt(TesterStatistics(STAT_TRADES));
}
```
- Only used when "Custom max" is selected in tester settings.
- Gotcha: MT5 caches optimization results; criterion is not part of the cache key. Delete the cache files to re-run after changing the criterion.
- AT24 version: add a minimum-trades gate (return 0 below N) and divide by max equity drawdown %, so the optimizer prefers stable parameters over lucky ones. Pairs with the M12 parameter-sensitivity evidence.
- Book caveat: forward-test validation is still required; a custom criterion does not guarantee live profit.

## 3. Frames (OnTesterInit / OnTesterPass / OnTesterDeinit, FrameAdd / FrameNext)
Agents push per-pass data (equity curve, trade list, stats) to the terminal during optimization, so one run yields a full per-pass report without manual exports. Candidate for an automated validation-report pipeline feeding the marketplace "evidence" pages. (The chapter URL I guessed returned 404; read the real page from the tester chapter index before implementing.)

## 4. Execution safety module (`AT24_EA_Core.mqh`, proposed)
From `experts_ordercheck` and the Creating-EAs chapter list:
- `OrderCheck(request, result)` returns margin / margin_free / margin_level / retcode / comment for a request before sending.
- Limits (per the book): a passing check does not guarantee execution; its margin accounting is simplified and does not handle netting/hedging closes the way `OrderCalcMargin` does.
- Production: always normalize price and volume before sending; detect the symbol's allowed fill mode (FOK/IOC/Return) instead of hardcoding; handle every `retcode` explicitly; use `OrderCalcMargin` / `OrderCalcProfit` for sizing; confirm async sends via `OnTradeTransaction`.
- Fits G01 v0.2 execution-integrity: turn that patch into a reusable include for all products.

## 5. Stress and robustness
- Custom symbols (`custom_symbols`): import own tick data, widen spread, synthetic/random series, renko/equi-range bars. Limits: no live trading on custom symbols; M1-bar minimum for timestamp sync. Use for "spread x2" and regime-shift tests.
- Deposits/withdrawals emulation and `TesterStop`: risk-of-ruin tests and early termination of hopeless passes.
- Multicurrency testing / multi-symbol EAs: portfolio evidence for M15 products.

## 6. News filter design
Calendar functions return `FUNCTION_NOT_ALLOWED (4014)` in the tester. Design: live EA/service saves calendar events to a file or SQLite; tester reads that file. Our existing economic-calendar feed (FairEconomy-based) can supply the dataset; note it only carries this week and no `actual` values.

## 7. Diagnostics channel
SQLite (EA-side trade/signal/reject log) and `WebRequest` (signed heartbeat to AT24). Foundation for Trader Edge Analyzer inputs and the MT5-MCP "EA-log diagnostics" idea. Not evaluated for broker/WebRequest allow-list friction yet.

## 8. Native MT5 MCP (VERIFIED against mql5.com article 23708 + forum 517731, 2026-10-07)
- Build 6060 ships a built-in AI Assistant (terminal + MetaEditor) and an internal MCP service on an authenticated endpoint; external MCP servers can also be attached.
- Tools: market data/charts, account/positions/history, Strategy Tester runs, chart/template/Market Watch management, code generation/compile, and trading (open/close/modify).
- Permissions: HTTP-method switch ("GET only" = read-only; "All requests" = file writes, compilation, backtests, real trading). Trading mode: disable / confirm / permit. EA-level `InpEnableTrading` is a separate switch. Users on the forum flag prompt-injection risk with "All requests".
- Not documented in the sources: transport/auth scheme, tool list, rate limits, which LLMs.
- Implication for AT24: local terminal control (chart, orders, tester, compile) is now commoditized by MetaQuotes for free. AT24's hosted MCP (read-only, 8 tools) must not compete there. Differentiators remain: edge_analysis (private user data), quant_backtest (our engine), market_intelligence, validated evidence. This matches the owner's 2026-10-07 conclusion: MCP = power-user bonus, no further MCP investment.
- Opportunity: native MCP makes `Strategy Tester` scriptable by an AI agent, which supports our validation-pipeline direction (section 10).

## 9. Auto-feed (implemented, local only)
`ea-research/mql5-feed/fetch-mql5dev.mjs`: scrapes the public preview t.me/s/mql5dev incrementally, tags posts (ea-execution, tester-validation, mcp-ai-platform, data-diagnostics, news-calendar, signal-logic, gold-fx), appends to `data/posts.jsonl`, writes `digests/YYYY-MM-DD.md`, remembers `state.json`. Run: `node fetch-mql5dev.mjs`. Not yet scheduled; no app/DB/prod changes.

## 10. Suggested order
1. Read MT5 Build 6060 article 23708; reconcile with AT24 MCP plan.
2. `AT24_EA_Core.mqh` prototype (section 4) and compile-test on a demo account.
3. Standard OnTester score + frames report template.
4. Stress protocol (real ticks + spread x2 custom symbol).
5. Schedule the feed (Windows Task Scheduler on the VPS, every few hours) and optionally ingest digests into the Support/K1 knowledge corpus.

## 11. AT24_EA_Core v0.1.0 verification (2026-10-07)
Code: `ea-research/AT24_EA_Core/` (Include/AT24_EA_Core.mqh, self-test script + tester EA).
- Compile: 0 errors, 0 warnings (MetaEditor, builds 6230 / current).
- Run: Strategy Tester (1-min OHLC model, XAUUSD M15, ICMarketsSC-Demo, 2026-08-03) -> `[SELFTEST] DONE pass=15 fail=0`. Fill mode picked IOC (symbol flags=2), lot-for-risk 0.20 lots = exactly 1% risk, OrderCheck pre-flight passed, spread guard and zero-volume guard blocked correctly.
- NOT covered: real `Open/Close/ModifySLTP` sends, retry path against a live broker, INVALID_FILL fallback. Only pre-flight + pure helpers are tested. Needs a demo-account forward run before replacing M12's hardcoded `ORDER_FILLING_FOK` (v2.10 line 288).

## 12. M12 v2.11 (AT24_EA_Core) parity backtest (2026-10-07)
`ea-research/marketplace-research/m12-gold-product-01/source/AT24_GOLD_PDHPDL_RangeBreaker_v2.11.mq5` = v2.10 with only the order layer changed (fill mode from symbol flags instead of hardcoded FOK; initial + pyramid entries via `CAT24Exec::Open`). v2.10 file untouched.
Same inputs, Strategy Tester, XAUUSD M15, 1-minute OHLC model, 2026-06-01..2026-08-14, EquitiBrokerageSC-Demo data, $10k, 1:500, history quality 100%:

| | v2.10 | v2.11 |
|---|---|---|
| Total trades | 64 | 64 |
| Net profit | -1,700.23 | -1,700.23 |
| Profit factor | 0.45 | 0.45 |
| Max equity DD | 17.74% | 17.74% |

Result: identical -> the execution layer does not change trading behaviour in the tester.
Caveats: (1) tester only; the retry / INVALID_FILL / unknown-outcome paths are not exercised by it. (2) This window is NOT the listed evidence period and shows the strategy losing (PF 0.45, DD 17.7%) on this data/model; it says nothing about v2.10's listed VALIDATED evidence but should be looked at before any new marketing claim. (3) v2.11 is a new binary: do not replace the v2.10 listing until the owner decides on re-validation.

### 12b. Real-ticks parity (same window/inputs, "Every tick based on real ticks", 100% real ticks, 40.95M ticks)
| | v2.10 | v2.11 |
|---|---|---|
| Total trades | 70 | 70 |
| Net profit | -374.78 | -374.78 |
| Profit factor | 0.89 | 0.89 |
| Max equity DD | 12.39% | 12.39% |

Parity holds on real ticks too. Note the model sensitivity on the SAME window: 1-minute OHLC gave 64 trades / -1,700 / PF 0.45 / DD 17.7%, real ticks gave 70 / -375 / PF 0.89 / DD 12.4%. This is the book's warning in practice: OHLC results must not be quoted as evidence. Even on real ticks this 10-week window is net negative, so the strategy needs a regime review (single window, single broker feed; not conclusive either way).
