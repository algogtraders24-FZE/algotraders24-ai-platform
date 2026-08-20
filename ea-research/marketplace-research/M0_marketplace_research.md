# M0 — Marketplace Research & Product Definition

**Scope:** MQL5 Marketplace (mql5.com / MetaTrader Market) as primary reference, with Collective2, Darwinex (Zero/DARWIN), TradingView (script publishing), and cTrader Store (cAlgo) as comparables. Research conducted 2026-08-19 via public documentation, help-center pages, and forum/community sources.

**Purpose:** Inform Sprint M0 product definition for AT24's algorithmic-trading marketplace. AT24's already-decided differentiator: every listed system carries independently computed evidence (backtest, out-of-sample/walk-forward, robustness, health score, trust-status badge) rather than relying on seller-provided claims. This report gathers evidence on how incumbents currently handle (or fail to handle) this trust problem.

---

## 1. Seller Side

### 1.1 MQL5 Market (primary reference)

**Becoming a seller**
- Requires an MQL5.community account, then registration in the "Seller" section of the user profile.
- Verification requires personal data plus a photo of an ID document. MQL5 markets this as "fully automatic," taking "no more than five minutes," though it is effectively a lightweight KYC step, not a trading-competence check.
- Source: [How to Become a Seller — MetaTrader 5 Help](https://www.metatrader5.com/en/terminal/help/market/market_sell)

**Product creation / submission flow** (multi-stage form)
1. Basic info: product name (capitalized, Latin characters/numbers only, ≤50 chars), category, supported account type (MT4/MT5), program type, pricing.
2. Logo & description: three logo sizes (200×200, 140×140, 60×60), free-text description.
3. Screenshots & video: up to 12 screenshots (640×480, English text required), optional YouTube tutorial link.
4. Product file: a single **compiled EX5 binary** — no source code, and DLLs are prohibited (a security/sandboxing measure, not a validation measure).
5. **Automated validation**: MQL5 runs an automatic check (~10 minutes) for programming/compile errors and basic trading functionality. This is explicitly a technical smoke test, not a performance or robustness audit — MQL5's own documentation states it "does not guarantee the profitability" of what's listed.
- Source: [How to publish a product on the Market — MQL5 Articles](https://www.mql5.com/en/articles/385); [MetaTrader 5 Market Seller Help](https://www.metatrader5.com/en/terminal/help/market/market_sell)

**Versioning / updates**
- New versions are pushed via a "Version" tab with a "New Version" action; a "What's New" changelog tab is shown to buyers.
- Product metadata (logo, description, screenshots) is editable anytime; price changes are capped at once per day.
- All updates are free to existing buyers and propagate within ~24 hours.
- Source: [MetaTrader 5 Market Help](https://www.metatrader5.com/en/terminal/help/market/market_sell)

**Pricing models**
- Free, one-time purchase (unlimited validity), or rental (1/3/6/12-month terms).
- $30 minimum price; MetaQuotes takes a **20% commission** (seller nets 80%).
- Each sold license includes a minimum of 5 device activations, hardware-bound (encryption-based DRM, not usage-based licensing).

**What a listing page contains**
- Name, category, author, price, current version + last-update date, star rating (1–5) and text reviews, screenshots, description, rental terms, activation count, free-demo availability.
- No standardized performance-metrics block (no mandated drawdown/profit-factor/win-rate table) — whatever backtest images or claims appear are seller-authored, inside the free-text description/screenshots, not a structured, verified field.

**Free/demo/trial model**
- Every paid product automatically gets a free "demo" build restricted to the **Strategy Tester only** — it cannot run on a live/demo chart, so it cannot be used for real or forward-tested trading, only historical backtesting inside MetaTrader's own tester.
- This is a meaningful gap: the trial mechanism proves the code runs, not that it's profitable or robust out-of-sample, and it doesn't let a buyer forward-test on their own broker feed before paying.
- Source: [MetaTrader 5 Market Buy Help](https://www.metatrader5.com/en/terminal/help/market/market_buy)

**Seller profile, reviews, ratings**
- Reputation signals are informal: account age/tenure, number of published products, forum/article participation. MQL5 also has an unofficial "Verified Seller"/"Top Rated" style badge tied to identity verification + sustained positive feedback, but it is not a performance-verification badge — it signals identity and longevity, not track-record quality.
- Star ratings and reviews are attached per-product. See Trust Layer (§3) for well-documented criticism of this system's integrity.
- Sources: [MQL5 forum discussion](https://www.mql5.com/en/forum/437182); [BLODSALGO seller guide](https://blodsalgo.com/blog/en/mql5-market-best-expert-advisors-guide/)

### 1.2 Collective2 (comparable — signal/strategy marketplace)

- Sellers ("system vendors") connect a live or simulated trading account; C2's infrastructure ingests trade fills directly rather than accepting seller-reported summary stats, which is a materially different trust model from MQL5's screenshot-based claims.
- Every strategy gets a standardized public statistics page: cumulative return, **Max Drawdown** (formally defined as worst peak-to-valley decline, methodology published), Sharpe ratio, win/loss ratio, capital-following/subscriber count, and a link to full risk disclosures.
- C2 explicitly labels results "simulated/hypothetical" for non-real-money systems and separately discloses that **AutoTrade** (the copy-execution layer) estimates and folds in subscription fees, per-trade AutoTrade fees, and broker commissions into the return calculation — an attempt to show realistic net-of-cost performance rather than a gross, cherry-picked equity curve.
- Sortable strategy leaderboard by return, drawdown, Sharpe, cost.
- Sources: [C2STATS methodology](https://collective2.com/c2explorer_help/html/bdb3335a-fbc3-4ae9-aac3-97dfa8615570.htm); [Max Drawdown definition](https://support.collective2.com/hc/en-us/articles/360000028748-Max-Drawdown-statistic); [AutoTrading FAQ](https://support.collective2.com/hc/en-us/articles/202846194-How-does-AutoTrading-work-exactly); [collective2.com/how-we-calculate-hypothetical-results, collective2.com/risks — referenced but not directly fetched]

### 1.3 Darwinex Zero / DARWIN (comparable — verified-track-record-to-product model)

- Structurally the closest philosophical analogue to what AT24 wants to build, but for discretionary/algo traders raising investable capital rather than an EA/indicator storefront.
- A trader must **trade first** (paying a monthly subscription, initially on virtual/allocated capital) before any product exists; Darwinex's own **Risk Engine** — not the trader — records and standardizes the data. Only after demonstrating a sustained, engine-recorded history does a DARWIN (investable index) get created.
- Products are scored on standardized **"Investable Attributes"**, not seller-chosen KPIs: Risk Stability (Rs, 0–10, based on 12 trailing "D-periods" of VaR stability, recency-weighted), Risk Adjustment (Ra, 0–10, frequency of Risk Engine intervention), Experience (Ex, 0–10, statistical significance/sample size of the track record).
- All DARWINs are risk-normalized to a common target (6.5% monthly VaR) so performance is comparable apples-to-apples across products — directly analogous to a "computed health/comparability score" rather than raw seller-reported numbers.
- Sources: [Darwinex Zero Track Record](https://info.darwinexzero.com/track-record); [Investable Attributes](https://help.darwinex.com/what-are-investable-attributes); [Risk Stability](https://help.darwinex.com/risk-stability-attribute); [Risk Adjustment](https://help.darwinex.com/risk-adjustment-attribute); [Risk Engine](https://help.darwinex.com/risk-manager)

### 1.4 TradingView & cTrader Store (lighter references)

- **TradingView**: publishing is governed by house rules/script-publishing rules; only Premium accounts may publish invite-only (closed-source) scripts, and even closed-source scripts must include a description explaining logic/claims, reviewed by moderators. Access to invite-only scripts must be manually granted per user — this is an access-control and moderation model, not a performance-validation model; TradingView does not verify any performance claims made in a script's description. Source: [Script publishing rules](https://www.tradingview.com/support/solutions/43000590599-script-publishing-rules/); [Private invite-only scripts](https://www.tradingview.com/support/solutions/43000615189-private-invite-only-scripts/); [Publishing invite-only scripts](https://www.tradingview.com/support/solutions/43000614617-publishing-invite-only-scripts).
- **cTrader Store (cAlgo)**: a straightforward app-store model for cBots/indicators/plugins built in C#/.NET; can run on desktop, VPS, or cTrader Cloud. Public documentation found is thin on any independent verification or performance-disclosure layer — it appears to be closer to MQL5's low-friction, seller-claims model. Source: [cTrader Store](https://ctrader.com/); [cTrader Algo docs](https://help.ctrader.com/ctrader-algo/).

---

## 2. Buyer Side

### 2.1 MQL5 Market

- **Discovery**: category navigation (Expert Advisors / Indicators / Libraries / Utilities), web-based filters (program type, price band, rating, rental availability), free-text search by name/description, sort by price or "newest."
- **No performance-based filter or sort** — a buyer cannot filter/sort by drawdown, win rate, or any independently verified metric because no such structured field exists platform-wide.
- **Pre-purchase information**: price, version + last-updated date, star rating + text reviews, screenshots, description, activation count, rental terms, demo availability. Any backtest/performance evidence shown is whatever the seller chose to screenshot — not a standardized, verifiable block.
- **Trial mechanics**: free demo build, Strategy-Tester-only (no live/demo-chart execution) — good for checking the code runs and eyeballing a tester equity curve, but it is the seller's own backtest environment/data, so it doesn't independently corroborate anything and cannot be used for real forward-testing before purchase.
- **Purchase/download/install**: one-click buy (MQL5 balance or external payment), immediate install to the MetaTrader `MQL5/Experts/Market/` (or Indicators/Market) folder, purchases tracked under "My Purchases." All future updates are free and auto-available within ~24h.
- **Refunds**: not documented in official MetaTrader help content surfaced in this research — implies either no formal buyer-initiated refund mechanism or one that's handled ad hoc/via support ticket rather than a stated policy. This is itself a notable gap.
- Sources: [MetaTrader 5 Market Buy Help](https://www.metatrader5.com/en/terminal/help/market/market_buy); [MetaTrader Market](https://www.mql5.com/en/market)

### 2.2 Collective2

- Public leaderboard, sortable by return, drawdown, Sharpe ratio, cost, subscriber count — i.e., buyers *can* filter/sort on standardized risk-adjusted metrics, unlike MQL5.
- Each strategy page carries a persistent, methodology-linked stats panel (not seller-editable free text) plus explicit hypothetical-result disclaimers.
- AutoTrade "trial": subscribers can run a strategy on a **paper-trade account** before committing real capital/fees — a materially stronger pre-purchase trial than MQL5's tester-only demo, because it forward-tests against live market conditions, not just historical data.
- Sources: [AutoTrading FAQ](https://support.collective2.com/hc/en-us/articles/203081640-What-is-AutoTrading); [Paper Trade AutoTrade setup](https://support.collective2.com/hc/en-us/articles/203159180-I-ve-setup-AutoTrade-for-a-Paper-Trade-account-Now-what)

### 2.3 Darwinex

- Buyers/investors select DARWINs using the standardized Investable Attributes (Rs, Ra, Ex) rather than raw, seller-narrated performance — effectively a pre-built comparison/scoring layer across all products, which is very close to what AT24 intends with a "health score."
- Source: [How to select DARWINs for investing](https://help.darwinex.com/select-darwins-for-investing)

---

## 3. Trust Layer (most important section)

### 3.1 What MQL5 actually verifies — and what it doesn't

- **Signals (live track records)**: MQL5.com's own infrastructure computes signal statistics from real trade data streamed through its cloud service, and it does distinguish real vs. demo accounts. This is a genuine, platform-computed track record — the closest thing MQL5 has to independent verification, and it's a useful pattern (server-side computed stats, not seller-submitted numbers). However: (a) statistics only start from when the account is registered on MQL5 — no way to verify or audit pre-registration history; (b) drawdown is calculated including floating (open) positions, which is disclosed but easy for a casual buyer to misread; (c) MQL5 itself, in community discussion, recommends buyers independently watch a signal on demo for 2–4 weeks before trusting it — i.e., even MQL5's best trust mechanism implicitly admits its own historical stats aren't sufficient grounds for a purchase decision.
- **Market products (EAs/indicators)**: there is **no equivalent verification layer**. Submission goes through only an automated *technical* check (compiles, runs, doesn't crash) — explicitly not a profitability or robustness check. Whatever backtest screenshots, equity curves, or performance claims appear on a listing are entirely seller-authored and unaudited.
- Sources: [MQL5 Signals forum thread — "Can MQL5 signals' track records be trusted?"](https://www.mql5.com/en/forum/89453); [How to publish a product on the Market](https://www.mql5.com/en/articles/385)

### 3.2 Disclosed testing period / broker / data dependency

- MQL5 Strategy Tester backtests are run against whatever historical tick/OHLC data the seller's own MetaTrader terminal has (broker- and history-depth-dependent). There is no platform-enforced standard dataset, no disclosure requirement for data quality/source, and no requirement to disclose the testing period, spread/slippage model used, or broker used to generate a promoted backtest. This is a structural, not incidental, gap.
- No public documentation found indicating MQL5 discloses or standardizes tick-data quality (e.g., "every tick based on real ticks" vs. generated), even though MetaTrader's own tester UI exposes this distinction — meaning even where the information exists, the marketplace doesn't surface or enforce it as a listing requirement.

### 3.3 Anti-fraud / anti-curve-fitting safeguards — largely absent, and this is widely known

- No parameter-robustness or walk-forward requirement for Market products. No forced out-of-sample holdout. No mandated minimum trade count for statistical significance. No detection for over-optimized/curve-fit parameter sets.
- Community and independent-reviewer criticism (converging across multiple independent sources found in this research) documents:
  - "MQL5 performs only a 'formal test' of products and explicitly does not guarantee the profitability of trading robots" — i.e., MQL5's own stated position disclaims responsibility for exactly the claim buyers care about most. [forexvitals.com — "The MQL5 Trap"](https://forexvitals.com/articles/mql5-trap)
  - Estimates cited that "more than 50% of products on the site likely contain fake positive reviews," alongside allegations of bait-and-switch updates (sellers strip features post-purchase to force repurchase) and vendors quietly discontinuing/removing underperforming products to erase the track record. [forexvitals.com](https://forexvitals.com/articles/mql5-trap)
  - Users reporting the review-filtering algorithm suppresses legitimate detailed reviews as "suspicious" while allowing large volumes of low-effort 5-star reviews on top sellers to stand, with no published explanation of the filter logic and forum moderators reportedly deleting threads that raise the concern. [MQL5 forum](https://www.mql5.com/en/forum/437182); [ForexRobotNation review](https://forexrobotnation.com/mql5-mql5-com-review-analysis/)
  - Independent trading-community consensus on curve-fitting: a backtest alone "proves nothing about robustness — it only proves the developer could find parameters that worked on historical data"; the more optimizable parameters and the fewer trades, the greater the curve-fitting/random-result risk; changing the data source or time alignment is a known, simple way to expose a curve-fit system, but MQL5 has no requirement or built-in tooling that does this automatically for buyers. [MQL5 forum — curve-fitting thread](https://www.mql5.com/en/forum/507733/page1); [MQL5 forum — over-optimization thread](https://www.mql5.com/en/forum/326752)
- **Net assessment**: MQL5's trust layer is essentially reputation-by-tenure plus a gameable star-rating system, with a real (but narrow, self-selected-cohort) verified-stats layer limited to the separate Signals product, not applied to the Market storefront where EAs are actually sold.

### 3.4 How the comparables do (or don't) better

| Dimension | MQL5 Market | MQL5 Signals | Collective2 | Darwinex |
|---|---|---|---|---|
| Who computes the stats | Seller (unaudited) | Platform (from live trade feed) | Platform (from connected account) | Platform (Risk Engine) |
| Standardized metrics shown | No | Partial (profit, drawdown, subscribers) | Yes (return, DD, Sharpe, W/L, cost-adjusted) | Yes (Rs, Ra, Ex — normalized 0–10) |
| Out-of-sample / robustness check | None | None (only "watch demo 2–4 weeks" advice) | None disclosed | Ongoing (Risk Engine actively intervenes) |
| Pre-purchase live/forward test | Strategy-Tester-only, seller's own data | N/A (subscribe = live copy) | Paper-trade AutoTrade | N/A (product only exists after live track record) |
| Fee/slippage-adjusted performance | Not disclosed | Not disclosed | Yes, explicitly modeled into returns | Implicit via risk normalization |
| Fraud/gaming safeguards publicly documented | None found; widely criticized as gameable | Real/demo account flag only | Simulated-vs-real labeling, published methodology | Risk Engine intervention + minimum track-record length for Experience score |

None of the comparables researched implement anything resembling AT24's full stack: **independent backtest re-verification + forced walk-forward/out-of-sample testing + parameter-robustness/anti-overfitting analysis + a single computed health score + a trust-status badge**, applied uniformly at point of listing. Darwinex comes closest in spirit (platform-computed, standardized, risk-normalized attributes) but operates on live discretionary/algo trading capital rather than validating a distributable EA/indicator product pre-sale. Collective2 comes closest on transparency of *live* results and cost-adjusted returns, but still does no *backtest* or curve-fit forensics, and results remain "hypothetical" for non-real-money systems.

---

## 4. Gaps AT24 Should Exploit

1. **No incumbent independently re-runs or audits seller-submitted backtests.** MQL5 explicitly disclaims profitability verification; Collective2/Darwinex only start "verifying" once a strategy is already live, and never touch the backtest/design stage at all. AT24's proposed backtest-evidence + out-of-sample/walk-forward pipeline *at listing time* has no direct competitor doing this for a productized EA/indicator marketplace.

2. **No incumbent screens for curve-fitting/over-optimization systematically.** The trading community clearly understands the diagnostic techniques (data-source/time-alignment shift tests, minimum trade-count thresholds, parameter-count limits) but no platform researched applies them as a gating requirement before a product can be listed. This is a well-known, widely-discussed pain point (multiple independent forum threads and reviewer articles) with zero platform-level tooling response — a direct, evidenced product opportunity for AT24's "parameter-robustness/anti-overfitting checks."

3. **No incumbent produces a single computed, comparable trust/health score at the product level for a downloadable/purchasable trading system.** Darwinex has the closest analogue (Rs/Ra/Ex), but it scores live discretionary capital-management performance, not a purchasable algo product with a backtest history. AT24's "system health score" + "trust-status badge" concept — applied to something a buyer can filter/sort/compare *before* purchase — is structurally absent from every platform surveyed.

4. **Review/rating integrity is a documented, publicly acknowledged weak point for the largest incumbent (MQL5).** Independent estimates suggest a majority of reviews on top-selling products may be inauthentic, and MQL5's opaque review-filtering algorithm is a recurring trust complaint. AT24 can differentiate by making its trust signal computed/objective rather than review-based, sidestepping this failure mode entirely rather than trying to build a "better star rating."

5. **No disclosed standard for data/broker/testing-period provenance.** None of MQL5, Collective2, or Darwinex publicly require or standardize disclosure of what data a backtest ran on, spread/slippage assumptions, or the exact testing window, even though this information is often technically available (e.g., MetaTrader's own tester distinguishes tick-data quality). A required, standardized "Evidence" disclosure block (data source, period, broker/spread model, in-sample vs. out-of-sample split) is low-hanging fruit no competitor currently enforces.

6. **Trial mechanisms are weak or absent across the board for algo *products* specifically.** MQL5's demo is backtest-only on the seller's own data (not independently corroborating); most platforms have no forward-paper-trial for a purchasable EA at all (Collective2's paper-trade AutoTrade is the exception, but that's for subscribing to live signals, not buying a redistributable product). A verified, platform-run forward-test/paper-trial period before a system earns "listed" or "ranked" status would be a differentiator with no direct precedent for productized EAs.

7. **Fee/cost-adjusted net performance disclosure is inconsistent.** Only Collective2 clearly models subscription + per-trade + commission costs into headline returns. MQL5 Market/Signals show gross backtest/live numbers without a standardized net-of-realistic-cost calculation. AT24's Risk layer could mandate cost-adjusted, broker-realistic performance reporting as part of the validation pipeline, not an afterthought.

8. **No platform surveyed publishes a machine-checkable "why this was approved/rejected" audit trail.** All current trust signals (MQL5 badges, review scores, C2 disclosures, Darwinex attributes) are either opaque algorithms or static disclaimers. A transparent, explainable validation report per system (what was tested, what passed/failed, why the health score is what it is) would be a genuine first for this market category and directly operationalizes AT24's "System + Evidence + Validation + Risk + History" thesis into something a buyer can actually inspect.

---

## Sources (consolidated)

- [How to Become a Seller — MetaTrader 5 Help](https://www.metatrader5.com/en/terminal/help/market/market_sell)
- [How to Purchase an App — MetaTrader 5 Help](https://www.metatrader5.com/en/terminal/help/market/market_buy)
- [How to publish a product on the Market — MQL5 Articles](https://www.mql5.com/en/articles/385)
- [MetaTrader Market](https://www.mql5.com/en/market)
- [How to become a Signals Provider — MQL5 Articles](https://www.mql5.com/en/articles/591)
- [MQL5 forum — "Can MQL5 signals' track records be trusted?"](https://www.mql5.com/en/forum/89453)
- [MQL5 forum — Rankings, ratings and reviews](https://www.mql5.com/en/forum/437182)
- [MQL5 forum — Curve-Fitted Backtests vs Real Edge](https://www.mql5.com/en/forum/507733/page1)
- [MQL5 forum — Over-optimization (curve fitting)](https://www.mql5.com/en/forum/326752)
- [MQL5 forum — Curve fitting sounds like scam](https://www.mql5.com/en/forum/440192)
- [forexvitals.com — "The MQL5 Trap: Is the Trading Standard Rigged Against You?"](https://forexvitals.com/articles/mql5-trap)
- [ForexRobotNation — MQL5.com Review & Analysis](https://forexrobotnation.com/mql5-mql5-com-review-analysis/)
- [BLODSALGO — Best EA on MQL5 Market: 7 Rules From a Top Seller](https://blodsalgo.com/blog/en/mql5-market-best-expert-advisors-guide/)
- [Collective2 — What is AutoTrading?](https://support.collective2.com/hc/en-us/articles/203081640-What-is-AutoTrading)
- [Collective2 — How does AutoTrading work exactly?](https://support.collective2.com/hc/en-us/articles/202846194-How-does-AutoTrading-work-exactly)
- [Collective2 — Paper Trade AutoTrade setup](https://support.collective2.com/hc/en-us/articles/203159180-I-ve-setup-AutoTrade-for-a-Paper-Trade-account-Now-what)
- [Collective2 — Max Drawdown statistic](https://support.collective2.com/hc/en-us/articles/360000028748-Max-Drawdown-statistic)
- [Collective2 — C2STATS methodology](https://collective2.com/c2explorer_help/html/bdb3335a-fbc3-4ae9-aac3-97dfa8615570.htm)
- [Darwinex Zero — Track Record](https://info.darwinexzero.com/track-record)
- [Darwinex — What are the Investable Attributes?](https://help.darwinex.com/what-are-investable-attributes)
- [Darwinex — Risk Stability attribute](https://help.darwinex.com/risk-stability-attribute)
- [Darwinex — Risk Adjustment attribute](https://help.darwinex.com/risk-adjustment-attribute)
- [Darwinex — How the Risk Engine works](https://help.darwinex.com/risk-manager)
- [Darwinex — How to select DARWINs for investing](https://help.darwinex.com/select-darwins-for-investing)
- [TradingView — Script publishing rules](https://www.tradingview.com/support/solutions/43000590599-script-publishing-rules/)
- [TradingView — Private invite-only scripts](https://www.tradingview.com/support/solutions/43000615189-private-invite-only-scripts/)
- [TradingView — Publishing invite-only scripts](https://www.tradingview.com/support/solutions/43000614617-publishing-invite-only-scripts)
- [cTrader Store](https://ctrader.com/)
- [cTrader Algo docs](https://help.ctrader.com/ctrader-algo/)
