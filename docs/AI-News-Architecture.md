# AI News Engine — Architecture

Foundation for the Algotraders24 financial news engine.
Mock-only. No external news APIs, no AI SDK, no backend.

## Layers

types → data → services → config → UI

- **types/** — news, economic-event, news-impact, calendar-event
- **data/** — news, economic-events, calendar
- **services/ai/** — news, economic-calendar, news-impact, headline-analysis
- **config/** — categories, impact levels, currencies, countries, importance
- **components/news/** — NewsCard, EconomicCalendar, ImpactBadge, HeadlineSummary, NewsFilter
- **app/dashboard/news/** — news dashboard page

## News Lifecycle

published → analyzed → impact-scored → displayed

Each article carries an AI summary and an impact object (level, score,
affected markets, direction) at creation. Services filter by category,
market, or impact level for display.

## Headline Analysis

Each article has an `aiSummary` — a short model-style takeaway. The
headline-analysis service exposes per-article summaries and an aggregate
market-impact string.

## Economic Calendar Flow

events → grouped by day → filtered by impact

Economic events hold importance, impact, actual/forecast/previous, and
event time. The calendar groups events into days; a high-impact filter
surfaces market movers.

## Impact Scoring

- **level** — low / medium / high
- **score** — 0–100 magnitude
- **affectedMarkets** — market categories touched
- **direction** — bullish / bearish / neutral

## Future NewsAPI Integration

Replace mock news returns with NewsAPI responses via an adapter mapping
payloads → `NewsArticle`. Service signatures unchanged.

## Future RSS Integration

An RSS adapter parses feeds into `NewsArticle` records, feeding the same
news service. No type or UI changes.

## Future AI Summarization

Replace the static `aiSummary` field with model-generated summaries in
the headline-analysis service. UI and types remain stable.