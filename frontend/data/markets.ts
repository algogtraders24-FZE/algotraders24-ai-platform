// data/markets.ts
// AI Signal Engine — mock market data

import type { Market, MarketQuote } from "@/types/market";

export const markets: Market[] = [
  { symbol: "EURUSD", name: "Euro / US Dollar", category: "forex", baseCurrency: "EUR", quoteCurrency: "USD", active: true },
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar", category: "crypto", baseCurrency: "BTC", quoteCurrency: "USD", active: true },
  { symbol: "SPX500", name: "S&P 500 Index", category: "indices", baseCurrency: "SPX", quoteCurrency: "USD", active: true },
  { symbol: "AAPL", name: "Apple Inc.", category: "stocks", baseCurrency: "AAPL", quoteCurrency: "USD", active: true },
  { symbol: "XAUUSD", name: "Gold / US Dollar", category: "commodities", baseCurrency: "XAU", quoteCurrency: "USD", active: true },
];

export const marketQuotes: MarketQuote[] = [
  { symbol: "EURUSD", price: 1.0842, change24h: 0.0021, changePercent24h: 0.19, high24h: 1.0865, low24h: 1.0810, volume: 128000, updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "BTCUSD", price: 94250, change24h: 1850, changePercent24h: 2.0, high24h: 95100, low24h: 91800, volume: 45200, updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "SPX500", price: 5920.5, change24h: -18.2, changePercent24h: -0.31, high24h: 5945, low24h: 5905, volume: 89000, updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "AAPL", price: 229.8, change24h: 3.1, changePercent24h: 1.37, high24h: 231, low24h: 226, volume: 51000, updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "XAUUSD", price: 2685.4, change24h: 12.6, changePercent24h: 0.47, high24h: 2692, low24h: 2670, volume: 34000, updatedAt: "2025-01-15T10:00:00Z" },
];