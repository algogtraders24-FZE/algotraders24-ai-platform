// data/mock-market.ts
import type { MarketQuote } from "@/types/market-analysis";

export const mockMarket: MarketQuote[] = [
  { symbol: "XAUUSD", name: "Gold", price: 2685.4, change: 12.6, changePercent: 0.47 },
  { symbol: "XAGUSD", name: "Silver", price: 31.85, change: -0.22, changePercent: -0.69 },
  { symbol: "EURUSD", name: "Euro / US Dollar", price: 1.0842, change: 0.0021, changePercent: 0.19 },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", price: 1.2718, change: -0.0035, changePercent: -0.27 },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", price: 157.42, change: 0.38, changePercent: 0.24 },
  { symbol: "BTCUSD", name: "Bitcoin", price: 94250, change: 1850, changePercent: 2.0 },
  { symbol: "ETHUSD", name: "Ethereum", price: 3380, change: 96, changePercent: 2.93 },
  { symbol: "NIFTY", name: "Nifty 50", price: 23540, change: 118, changePercent: 0.5 },
  { symbol: "BANKNIFTY", name: "Bank Nifty", price: 50480, change: -210, changePercent: -0.41 },
  { symbol: "NASDAQ", name: "Nasdaq 100", price: 21120, change: 145, changePercent: 0.69 },
  { symbol: "SP500", name: "S&P 500", price: 5920.5, change: -18.2, changePercent: -0.31 },
];

export function getQuote(symbol: string): MarketQuote | undefined {
  return mockMarket.find((m) => m.symbol === symbol);
}