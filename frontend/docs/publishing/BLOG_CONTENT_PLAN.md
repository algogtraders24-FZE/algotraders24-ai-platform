# Blog content plan (SEO) - Phase 1

Status: 2026-10-14. Search-volume data was NOT available when this was written - validate every
topic below against Google Search Console (queries already earning impressions) before writing.

## Why a plan, not just more automated posts
Finance is YMYL. Google's spam policy targets "scaled content abuse" (many low-value pages made mainly
to rank). Automated daily pages are useful as a fresh-content series but must not be the whole blog.

## Automated series (live, cron `/api/private/publishing/auto-daily`, 06:15 UTC)
| Series | When | Source | AI? |
|---|---|---|---|
| Daily instrument report (gold, a forex pair, a crypto pair) | Mon-Fri; Sat/Sun crypto only | Market Intelligence pipeline | restates evidence |
| Fundamental Analysis (gold / EUR/USD) | Tue / Thu | same pipeline, fundamentals question | restates evidence |
| Economic Calendar Preview | Mon | FairEconomy feed, high-impact only | none (deterministic) |
| Weekly Market Review (gold, EUR/USD, BTC) | Sun | same pipeline x3 | restates evidence |

Max 4 articles/day. A report with no live data is skipped, never filled.

## Trust + SEO plumbing (live in this phase)
- Byline "By Algotraders24 AI - automated, evidence-based analysis" + link to `/methodology` (honest: no fake human author).
- schema.org `Article` JSON-LD on every post; `/methodology` in the sitemap; related-posts + marketplace / Quant Lite internal links.

## Evergreen guides (HUMAN-REVIEWED, owner to approve each before publishing)
Demand signal = MQL5 job postings and listings, not search volume. Each guide links to the matching
marketplace products and uses our own evidence (Trust State, live results, backtests) as the differentiator.

1. **Best EA for gold (XAUUSD): how to judge one** - what to check (drawdown, trade count, live vs backtest, spread/slippage), our Trust State checks; link gold listings.
2. **How to backtest an EA in MT5 properly** - tick data quality, modelling mode, walk-forward, common mistakes; link Quant Lite.
3. **Prop-firm-friendly EAs: daily loss and drawdown rules** - how EA risk settings map to prop-firm limits; link relevant listings.
4. **Convert a TradingView strategy to an MT5 EA** - Pine to MQL5 caveats; link Quant Lite code generation.
5. **How much does an EA cost (build vs buy)** - commercial-intent page; link marketplace + seller guide.

## Next (not built yet)
- Category hub pages (/blog/category/gold etc.) once there are enough posts.
- Archive/noindex policy for old daily pages if thin-content signals appear in Search Console.
- Calendar preview for next week (the feed currently serves this week only).
