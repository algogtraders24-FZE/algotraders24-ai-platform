# Evidence engine: extra evidence sources (2026-10-14)

## What was wrong
The Market Intelligence pipeline has eight evidence types (price, technical, news, macro, sentiment, historical-pattern,
cross-asset, provider-meta) but the production real-time path (`RealTimeIntelligenceService`, used by the AI Signals page, the
workspace, chat and the Market Intelligence agent) built the pipeline from market data ALONE. So an analysis always had one
type (price), `data-gap` was always "7 of 8 evidence types missing" = HIGH, and the overall risk (the worst of 8 categories)
read High for every symbol. The seam for more sources existed (EvidenceSourceGroup / fusion) but nothing used it.

## What now feeds it (all best-effort, none required)
| Evidence type | Source | Content |
|---|---|---|
| macro | `EconomicCalendarEvidenceSource` (FairEconomy calendar) | next <=3 high-impact events in 48h for the symbol's currencies, with forecast/previous; "none scheduled" only when the whole window is inside the fetched week |
| cross-asset | `MacroDriverEvidenceSource` (services/macro) | each available macro driver reading (DXY, stocks, AUDJPY barometer, yields, real yield) naming its feed, plus the alignment summary ("rule-based agreement, not a forecast") |
| news | `StoredNewsEvidenceProvider` -> `SharedNewsCacheProvider({refresh:false})` | stored headlines from the daily ingest (never a live Alpha Vantage refresh on this path) |
| sentiment, historical-pattern | - | still honestly absent: no real source; nothing invents them |

Rules enforced: one source name per evidence type (the ranking stage flags same-type/different-source claims as conflicts, so
two unrelated readings under different names would create spurious conflicts); each source has a 4s timeout and a failure
means "no evidence from it"; a symbol without a macro profile gets no macro-driver evidence; sources are loaded lazily (the
calendar/news/macro services are server-only).

## Effect
price-only (1 of 8) -> price + macro + cross-asset + news (4 of 8): `data-gap` HIGH -> MEDIUM, the Signals cards show
"Evidence: price · macro · cross-asset · news (4 of 8 types)". The Intelligence Score stays a data-completeness measure.

## Still open (separate work)
historical-pattern evidence from the outcome history; a real sentiment source; provider-meta; the technical type is only
present when the market-data provider supplies a technical summary (the Exness bridge supplies candles, not a summary - the
regime/market-state engines already use them, but they are not emitted as evidence items).
Tests: `npm run validate:evidence-sources` (14).
