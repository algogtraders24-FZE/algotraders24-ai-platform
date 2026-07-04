# AI Signal Engine — Architecture

Foundation for the Algotraders24 AI trading signal engine.
Mock-only. No broker, no TradingView, no live APIs.

## Layers

types → data → services → config → UI

- **types/** — signal, market, analysis, risk contracts (strict TS, no `any`)
- **data/** — mock datasets (signals, markets, analyses)
- **services/ai/** — read-only accessors returning mock data
- **config/** — supported markets, signal types, risk levels, thresholds
- **components/signals/** — reusable UI (cards, table, badges, filters)
- **app/dashboard/signals/** — signals dashboard page

## Signal Lifecycle

pending → active → closed / expired / cancelled

A signal is created by the engine with an entry, stop loss, and take-profit
targets, a confidence score, and a risk level. It stays `active` until its
targets hit or `expiresAt` passes. Outcomes are recorded in signal history.

## Market Analysis Flow

1. Select market (category + symbol)
2. Compute trend + strength per timeframe
3. Evaluate indicators (RSI, MACD, EMA) → per-indicator signal
4. Produce a summary + `analyzedAt` timestamp

## Confidence Scoring

Normalized 0–100 from three weighted parts:
- trendScore (trend direction + strength)
- indicatorScore (indicator agreement)
- volumeScore (participation)

Thresholds: high ≥ 85, medium ≥ 70, low ≥ 50.

## Risk Scoring

Each level maps to a fixed profile (score, volatility, exposure %):
- low — 25 / 20 / 1%
- medium — 55 / 50 / 2%
- high — 85 / 80 / 3%

Combined with max drawdown and risk/reward ratio in a risk assessment.

## Future Integrations

- **TradingView** — replace mock analysis with webhook/chart data feeding
  the analysis service. Contracts already isolate this behind services/ai.
- **MT5** — map `Signal` targets to MT5 order structures via an adapter;
  no UI or type changes required.
- **Broker** — execution layer consumes `active` signals; a new
  `execution.service` sits beside the AI services. Types stay untouched.

All future work swaps the data source behind the existing service functions.
UI and types remain stable.