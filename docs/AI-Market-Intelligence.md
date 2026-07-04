# AI Market Intelligence — Architecture

Foundation for the Algotraders24 Market Intelligence module.
Mock-only. No external APIs, no AI SDK, no backend.

## Layers

types → data → services → UI

- **types/** — market-intelligence, trend, sentiment, volatility, liquidity
- **data/** — mock datasets (market-intelligence, trend, sentiment)
- **services/ai/** — read-only accessors returning mock data
- **components/market/** — TrendCard, SentimentGauge, VolatilityCard, LiquidityPanel, MarketOverview
- **app/dashboard/market-intelligence/** — intelligence dashboard page

## Scoring

- **Overall Market Score** (0–100) — composite per symbol; page averages all symbols.
- **Trend strength** (0–100) — trend conviction.
- **Sentiment score** (-100 to 100) — bearish to bullish; bar maps to 0–100.
- **Volatility** — low / medium / high, index value 0–100.
- **Liquidity** — thin / normal / deep, score 0–100 + spread.
- **Confidence** (0–100) — reliability of the composite read.

Volatility and liquidity values are derived from the intelligence record
via map tables in their services, keeping one source of truth.

## Future AI Integration

Replace mock service returns with model inference outputs. Service
signatures stay identical — only the data source changes. Sentiment
and trend scoring become model-driven.

## Future MT5 Integration

An MT5 adapter feeds live tick/volatility/spread data into the
volatility and liquidity services. No type or UI changes required.

## Future TradingView Integration

TradingView webhooks map to trend and sentiment records via an adapter,
feeding the trend and sentiment services. UI and types remain stable.