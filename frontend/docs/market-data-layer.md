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
ETHUSD). Indices/stocks are modelled in the registry but disabled until a
provider mapping is wired.

## No-fabrication rules

- An indicator without enough candles is **`undefined` → "Insufficient data"**,
  never estimated.
- Absent provider fields stay absent (never a guessed 0/neutral default).
- No synthetic trade setups, no invented support/resistance, no fabricated RSI.
- API keys never appear in logs, error messages, screenshots, or commits.

## Validation matrix (Sprint D2.2 Phase 8)

| Scenario | Result |
| --- | --- |
| Invalid symbol | Typed `unsupported_symbol`; aggregate error lists attempts |
| Missing provider | `unconfigured`; service reports honestly, no crash |
| Rate limit | Not retried; fast fallback to next provider (or graceful reject) |
| Timeout | Per-attempt timeout → typed `timeout` → fallback |
| Retry | Transient `http_error`/`timeout` retried with backoff (verified 3 attempts) |
| Cache | Per-provider + service TTL caches serve repeat reads |
| Fallback | Primary failure falls through to secondary provider |
| Concurrent requests | 10 concurrent → 8 ok, 2 gracefully rate-limited, no crash |

**Known limitation / future work:** concurrent *identical* requests are not yet
coalesced (each hits the provider before the cache populates). In-flight request
de-duplication and a shared (Redis) cache are natural next steps for multi-
instance deployments. Series-based indicators currently use `/time_series`;
Alpha Vantage time-series fallback is a future addition where appropriate.
