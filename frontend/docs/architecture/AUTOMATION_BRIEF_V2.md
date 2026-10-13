# Automation Brief v2 + Macro Alignment (gold, EUR/USD, USD/JPY, Bitcoin, crude oil)

Follow-up to `AUTOMATION_P2_DELIVERY.md`. Phase 2 delivered results; users found the text unreadable
("regime low-volatility (confidence 100)") and repetitive. Brief v2 makes the delivered result plain,
adds context, and stays silent when nothing changed. Competitor R&D (distinction.ae, 2026-10-12): their
"Macro Conviction %" has no published method; ours is a documented, auditable rule.

## What changed

| Area | Change |
|---|---|
| `services/automation/brief.ts` | Plain-language Market Intelligence headline (`Gold (XAUUSD 1h): leaning bullish - trending up`); jargon basis lines dropped; optional `previous` output -> `changed` + `changeNote` |
| `types/automation.ts` | `AutomationDeliveryConfig.mode?: "always" \| "on_change"`; `AgentBrief.changed/changeNote` |
| `services/automation/delivery.ts` | `on_change` skips (reason `no-change`) when every comparable brief is unchanged. First run / non-comparable briefs count as changed. `deps.enrich` adds extras for gold MI only |
| `services/automation/brief-extras.ts` (pure) | price line, today's high-impact events in IST with countdown |
| `services/automation/delivery-deps.ts` | production `enrich`: macro snapshot + USD high-impact calendar. Each part best-effort |
| `services/automation/dispatcher.ts` + repository | loads the previous SUCCEEDED run's agent outputs for the comparison |
| templates | Gold Morning Intelligence + Evening Outlook Draft deliver `on_change`; Daily Market Brief stays `always` |
| Builder | "Only notify me when something changed" toggle |
| `services/macro/*`, `/api/private/macro-alignment`, `components/macro/MacroAlignmentCard.tsx` | Macro Alignment gauge card on `/dashboard/automation` |

No migration, no new tables, no new cron.

## Macro Alignment - the formula (shown on the card)

Five drivers, each reads +1 (supports gold), -1 (headwind) or 0 (neutral); missing data is dropped, never estimated.

| Driver | Weight | Source | Rule |
|---|---|---|---|
| Real yield | 30 | FRED DFII10 (needs `FRED_API_KEY`) | 5-obs change <= -0.05pp: +1; >= +0.05pp: -1 |
| US dollar | 20 | Twelve Data UUP (proxy) | day change <= -0.15%: +1; >= +0.15%: -1 |
| Treasury yields | 15 | Twelve Data IEF (proxy) | day change >= +0.15%: +1; <= -0.15%: -1 |
| Risk sentiment | 10 | Twelve Data VIXY (proxy), day change only | >= +2%: +1, else 0 (calm is never a headwind) |
| Gold momentum | 25 | Twelve Data XAU/USD | >= +0.3%: +1; <= -0.3%: -1 |

* Lean = sign of the weighted sum. Score = share of available weight pointing the same way as the lean.
* Under 3 available drivers -> no score. A lean backed by under 50% of the weight is labelled "Mixed".
* NOT a forecast or probability. Weights are a research-based choice (real yields and dollar are the most-cited
  gold drivers), not a proven edge. The card says so.
* Proxies are labelled as proxies. VIXY decays, so only its day change is used.
* VIX itself is not used: FRED's VIXCLS is CBOE-copyrighted.
* FRED attribution is shown whenever the real-yield driver contributes (FRED API terms).
* Twelve Data Basic = 8 req/min; one snapshot is 4 quotes, cached 5 minutes in-process.

## Tests

`npm run validate:macro-alignment` (scoring, fetch degrade paths, cache, IST events), `validate:automation-brief`,
`validate:automation-delivery`, lifecycle + `validate:automation-p2-smoke` (real DB, synthetic users).

## Update 2026-10-13: more assets (per-asset profiles)

The scorer is now profile-based (`ASSET_PROFILES` in `services/macro/macro-alignment.ts`). Same formula for every
asset; each asset has its own drivers, weights and thresholds, and lists what it does NOT cover. "Supports" always means
"favours a higher price". The card has an asset selector (`/api/private/macro-alignment?asset=gold|eurusd|usdjpy|btcusd|oil`).

| Asset | Drivers (weight) | Own quote | Not covered |
|---|---|---|---|
| Gold | real yield 30, dollar 20, Treasuries 15, volatility spike 10 (support), momentum 25 | XAU/USD | central-bank buying, geopolitics |
| EUR/USD | dollar 30, Treasuries 15, stocks 15, volatility spike 10 (headwind), momentum 30 | EUR/USD | euro-area data / ECB; dollar and momentum overlap (EUR is most of the dollar basket) |
| USD/JPY | US 10Y yield (FRED DGS10) 30, Treasuries 20 (inverse), stocks 15, volatility spike 10 (headwind), momentum 25 | USD/JPY | BoJ policy / intervention |
| Bitcoin | stocks 25, dollar 15, real yield 20, volatility spike 10 (headwind), momentum 30 (1% threshold) | BTC/USD | on-chain / ETF flows |
| Crude oil (WTI) | dollar 25, stocks 25, volatility spike 10 (headwind), momentum 40 (0.8%) | USO (ETF proxy) | inventories, OPEC+, geopolitics; USO is a proxy, not spot WTI |

* Quote drivers use Twelve Data ETF proxies: UUP (dollar), IEF (Treasuries), QQQ (stocks), VIXY (volatility, day change only),
  USO (oil). Quotes are cached 5 min per symbol, FRED series 30 min, a failed fetch 60s. A cold gold card = 5 quotes; switching
  asset re-uses the shared ones (Twelve Data Basic = 8 req/min).
* FRED series: DFII10 (real yield), DGS10 (US 10Y) - Board of Governors H.15, public domain, citation requested.
* Silver and spot WTI/Brent need the Twelve Data Grow plan (not served on Basic). BNO (Brent ETF) is available as a proxy if wanted.
* Brief v2 extras (price, macro line, today's events in IST) now run for any Market Intelligence symbol that has a profile
  (XAUUSD, EURUSD, USDJPY, BTCUSD); events use that asset's currencies. Oil has no Market Intelligence agent, so it appears on the card only.
* Weights/thresholds are a research-based choice, not backtested. The card shows the formula, the caveat and "not covered".

* **Coverage rule (2026-10-13):** a score needs at least 3 drivers AND the drivers with data must carry >= 70% of the asset's
  total weight. Found on the live dashboard: oil showed "83% headwind" with its own price missing (weight 40). Now it reads
  "Not enough data" until the quote is back. Mini cards show "n/m drivers".

## Update 2026-10-13: MT5 (Exness) first, Twelve Data as fallback

Verified with the admin diagnostic `/api/private/admin/mt5/symbols` (313 symbols on the Exness terminal): **DXY** (dollar
index), **USTEC / US500 / US30** (indices), **USOIL / UKOIL** (WTI / Brent) exist; **VIX and bond yields do not**.

`services/macro/macro-data.ts` now resolves each reading MT5-first:

| Reading | Exness (bridge `/candles?interval=1d&count=2`) | Fallback |
|---|---|---|
| Asset own price + day change | XAUUSD, XAGUSD (real silver), EURUSD, GBPUSD, USDJPY, BTCUSD, ETHUSD, USOIL | Twelve Data (XAU/USD, SLV, ..., USO) |
| US dollar | DXY | UUP |
| Stocks | USTEC | QQQ |
| Treasuries / volatility / real yield | - | IEF, VIXY (Twelve Data), FRED DFII10 / DGS10 |

Day change = forming daily candle vs the previous close (broker day). A symbol the bridge does not map yet (404), a bridge
outage or a single-candle answer falls back to Twelve Data automatically; every reading's source is shown on the card, and a
price that came from a proxy keeps the proxy's label. Twelve Data is now only 2 quotes per asset (IEF, VIXY), so the
8 req/min limit no longer bites the Signals/dashboard pages.

**VPS step:** the bridge's `SYMBOL_MAP` (mt5-bridge/bridge.py) gained DXY, USTEC, US500, US30, USOIL, UKOIL. Copy bridge.py
to the VPS and restart the bridge task; until then DXY/USTEC/USOIL fall back to UUP/QQQ/USO. Own-asset quotes work without it.
