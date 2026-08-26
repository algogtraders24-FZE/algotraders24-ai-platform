# Market Data Layer (Sprint D2.2)

A vendor-independent market-data layer. Every module (Market Intelligence,
Dashboard, AI Assistant, Trading Copilot, future research) consumes market data
through **one** service that returns a normalized model — never a vendor API
directly. Adding or swapping a provider changes nothing above the provider line.

## Environment

Server-only. **Never expose any of these through a `NEXT_PUBLIC_*` variable.**

| Variable | Purpose | Required |
| --- | --- | --- |
| `TWELVEDATA_API_KEY` | **Primary** provider (Twelve Data). Quotes, OHLC snapshots, time-series. | Recommended |
| `ALPHA_VANTAGE_API_KEY` | **Secondary / fallback** provider (spot exchange-rate + news only). | Optional |
| `GEMINI_API_KEY` | AI explanation layer (restate-only). | For AI explanations |

Each key is optional at the platform level: the layer returns a typed
"unconfigured" outcome and falls back rather than crashing when a key is absent.

## Provider priority

1. **Primary — Twelve Data.** Forex, commodities (metals), crypto, indices,
   stocks. Real OHLC, market status, and `/time_series` history. Free tier
   ≈ 800 req/day, 8 req/min.
2. **Secondary — Alpha Vantage (fallback).** Spot exchange-rate + news only
   (no OHLC; metals rejected on the current key). Preserved so the platform
   keeps operating for evidence/context if Twelve Data is unavailable.

`MarketDataService` tries providers in this order and falls back on any typed
provider error.

## Capabilities

| Capability | Interface | Twelve Data | Alpha Vantage |
| --- | --- | --- | --- |
| Evidence context | `MarketDataProvider.getMarketContext` | ✅ | ✅ (spot only) |
| Structured snapshot (OHLC, status) | `SnapshotProvider.getSnapshot` | ✅ | — |
| Historical candles | `TimeSeriesProvider.getTimeSeries` | ✅ | — (future) |

Capabilities are additive and detected at runtime (`isSnapshotProvider`,
`isTimeSeriesProvider`), so a spot-only provider is never forced to fabricate
OHLC it does not have.

## Architecture

```
Twelve Data API   (+ future: Polygon, broker feeds, Alpha Vantage)
      │
      ▼  Provider (implements MarketDataProvider / Snapshot / TimeSeries)
      ▼  Normalization  → MarketSnapshot / Candle / evidence
      ▼  Reliability     (timeout · retry · backoff)   lib/market-data/reliability.ts
      ▼  Caching         (per-provider + service TTL)
      ▼  MarketDataService  ← single entry point (getMarketContext/getSnapshot/getTimeSeries)
      │
 ┌────┼───────────────┬──────────────┐
 ▼    ▼               ▼              ▼
Dashboard   Market Intelligence   AI Assistant / Trading Copilot
```

**AI Context Builder** (Trading Copilot): `MarketSnapshot → Indicator Engine →
TechnicalContext + RiskContext → structured JSON → Gemini (restate-only) →
natural language`. The AI never sees a raw provider response and may not add a
value not present in the structured context.

## Key files

- `lib/market-data/providers/twelve-data.provider.ts` — primary provider
- `lib/market-data/providers/alpha-vantage.provider.ts` — fallback provider
- `services/market-data/market-data.service.ts` — central service (selection/cache/fallback)
- `lib/market-data/reliability.ts` — timeout/retry/backoff
- `lib/market-data/market-registry.ts` — canonical multi-asset catalog
- `lib/market-data/indicators.ts` — pure indicator engine (RSI/EMA/SMA/ATR/MACD/Bollinger)
- `types/market-snapshot.ts`, `types/market-candle.ts`, `types/technical-context.ts` — normalized models
- `services/ai/market-context-builder.service.ts`, `services/ai/technical-context.service.ts`,
  `services/ai/trading-copilot.service.ts` — AI context layer

## Enabled markets

Forex (EURUSD, GBPUSD, USDJPY), commodities (XAUUSD, XAGUSD), crypto (BTCUSD,
ETHUSD, SOLUSD, XRPUSD — Sprint D2.3.S3, live-verified against Twelve Data's
`/quote` endpoint before being added). Indices/stocks are modelled in the
registry but disabled until a provider mapping is wired. Alpha Vantage has no
crypto mapping (it's an FX-only endpoint) - a crypto symbol correctly produces
`unsupported_symbol` there, which the fallback loop tolerates cleanly.

## No-fabrication rules

- An indicator without enough candles is **`undefined` → "Insufficient data"**,
  never estimated.
- Absent provider fields stay absent (never a guessed 0/neutral default).
- No synthetic trade setups, no fabricated RSI. Support/Resistance/Pullback
  (Sprint D2.7.11 post-completion, 2026-08-25) ARE now computed - but only
  as a real recent high/low range and a real Fibonacci retracement, never
  an invented level; see `lib/market-data/indicators.ts`'s
  `keyPriceLevels()` and `types/intelligence-panel.ts`'s `KeyLevels`.
- API keys never appear in logs, error messages, screenshots, or commits.

## Validation matrix (Sprint D2.2 Phase 8)

| Scenario | Result |
| --- | --- |
| Invalid symbol | Typed `unsupported_symbol`; aggregate error lists attempts |
| Missing provider | `unconfigured`; service reports honestly, no crash |
| Rate limit (Sprint D2.3.S3) | Retried in-place with backoff (same budget as timeout/http_error), then falls back to the next provider if still failing |
| Timeout | Per-attempt timeout → typed `timeout` → fallback |
| Retry | Transient `http_error`/`timeout`/`rate_limit` retried with backoff (verified 3 attempts) |
| Cache | Per-provider + service TTL caches serve repeat reads |
| Fallback | Primary failure falls through to secondary provider |
| Stale-cache fallback (Sprint D2.3.S3) | Both providers fail + a cache entry exists within `MARKET_STALE_FALLBACK_MS` (default 5min) → served with `cached: true`, never presented as live |
| Concurrent requests | 10 concurrent → 8 ok, 2 gracefully rate-limited, no crash |

## Reliability & resilience (Sprint D2.3.S3)

- **Provider Health Monitor** (`lib/market-data/health-monitor.ts`): a small
  in-memory rolling window (last 20 outcomes) per provider, classified into
  `healthy | degraded | rate_limited | offline`. Owned by the shared
  `MarketDataService` instance (`services/market-data/shared-instance.ts`) so
  every route's real traffic feeds the same monitor. Resets on server
  restart - a live signal, not a historical record. Exposed via
  `GET /api/private/market-data/health` (full detail) and folded into
  `GET /api/private/market-data/status`'s `primaryState` field (drives the
  Workspace `ProviderStatus` dot color).
- **Standardized error DTO** (`lib/market-data/error-dto.ts`): every
  market-data-facing route (`snapshot`, `snapshots`, `market-intelligence/
  analyze`, `trading-copilot/analyze`) returns the same failure shape at
  `error.details`: `{ success: false, reason, provider, retryAfter?, cached,
  timestamp }`. `reason` is a small public vocabulary (`unconfigured`,
  `unsupported_symbol`, `auth_error`, `rate_limited`, `provider_error`,
  `timeout`, `invalid_response`, `unknown`), mapped from the internal
  `MarketDataErrorKind` - that internal contract is unchanged.
- **Stale-cache fallback**: distinct from ordinary caching. When every
  configured provider fails, `MarketDataService` checks the cache one more
  time and accepts an entry up to `staleFallbackMs` old (default 5 minutes,
  `MARKET_STALE_FALLBACK_MS`-overridable) rather than failing immediately.
  Always honestly stamped `cached: true` / `cacheAgeMs` on the response -
  `WorkspaceHeader` shows "Stale" instead of "Live" when this happens.
- **Startup validation** (`instrumentation.ts`, project root): runs once
  when a new server instance starts, before it serves any request. Logs
  (via `logger.child("startup")`) whether `TWELVEDATA_API_KEY`/
  `ALPHA_VANTAGE_API_KEY` are present - `error` if both are missing, `warn`
  per missing key otherwise, `info` when both are configured. Never logs a
  value, only presence/absence.

## Troubleshooting

**A provider reports `unconfigured` even though the key is set in `.env.local`.**
Symptom: an analysis fails with e.g. `No provider could serve "BTCUSD"
(twelve-data: unconfigured)` while `TWELVEDATA_API_KEY` is clearly present in
`.env.local`.

Cause: Next.js reads `.env.local` **once, at server startup**. A dev server
that was already running when the key was added (or changed) keeps serving with
its original, keyless environment — so `loadTwelveDataEnv()` returns `null` and
the provider is `unconfigured`. This is an operational/stale-process issue, not
a code bug.

Fix (local): **restart the dev server** (`npm run dev`) after editing any
`.env*` file. To confirm the running process actually has the key, check that
`process.env.TWELVEDATA_API_KEY` is a non-empty string in a server context. A
correctly-started server loads all of `TWELVEDATA_API_KEY`,
`ALPHA_VANTAGE_API_KEY`, and `GEMINI_API_KEY` and serves EURUSD / XAUUSD /
BTCUSD via Twelve Data.

**On production / a deployed site this is almost always the cause.**
`.env.local` is git-ignored and is **never deployed** — it only exists on the
local machine. A deployed server reads its environment from the **hosting
platform's** configuration, not from any committed file. If a live deployment
reports `unconfigured`, the fix is:

1. Add the server-only variables to the hosting platform's Environment
   Variables (e.g. Vercel → Project → Settings → Environment Variables):
   `TWELVEDATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `GEMINI_API_KEY`, and the rest
   of `.env.example`. **Never** prefix any of them with `NEXT_PUBLIC_`.
2. **Redeploy** — env changes take effect on the next deployment/restart, the
   same "read once at startup" rule as local.

Because env vars load at process start, no code change can make a process that
lacks the key start using it — the key must be present in that environment.

**Known limitation / future work:** concurrent *identical* requests are not yet
coalesced (each hits the provider before the cache populates). In-flight request
de-duplication and a shared (Redis) cache are natural next steps for multi-
instance deployments. Series-based indicators currently use `/time_series`;
Alpha Vantage time-series fallback is a future addition where appropriate.
