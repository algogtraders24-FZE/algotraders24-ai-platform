# AI Trading Copilot

Professional trading analysis dashboard. Mock market data + Gemini commentary. No live broker, no real-time feed yet.

## Architecture

Symbol -> analyzeMarket() -> sub-services (technical, support/resistance, liquidity, bias, trade-setup, risk, confidence) -> MarketAnalysis -> UI cards. Analyze button -> Prompt Engine -> Gemini -> commentary.

## Service Flow

analyzeMarket orchestrates:
- technical-analysis (EMA, RSI, MACD, ATR, trend strength)
- support-resistance (levels + breakout zones)
- liquidity-analysis (buy/sell side, equal highs/lows)
- market-bias (bullish/bearish/neutral + confidence)
- trade-setup (entry, SL, TP, R:R)
- risk-engine (risk %, R:R, lot, quality)
- confidence-engine (weighted score)

All values are deterministic from the mock price, so results are consistent per symbol.

## Commercial Readiness

Each service exposes FeatureMeta (featureId, requiredPlan, estimatedCost, dailyUsageWeight). The future Subscription Engine reads these to gate features and meter usage. No billing implemented yet.

## Gemini Integration

The Analyze button builds a prompt from the computed setup and sends it through the existing Prompt Engine and Gemini provider. If the API is unavailable, the dashboard still shows full mock analysis; only the commentary is skipped.

## Future Live Data

Replace mock-market.ts with a market-data API (price feed). The analysis services keep the same inputs, so no UI change.

## Future MT5 Integration

An MT5 adapter maps trade-setup output to MT5 order structures for execution or one-click send.

## Future TradingView Integration

TradingView webhooks or charting can feed real indicator values into the technical-analysis service, replacing mock indicators.