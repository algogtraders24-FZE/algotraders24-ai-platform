// types/crypto-flow.ts
// Crypto Flow - real buyer / seller aggressor delta for BTC and ETH from the public Binance spot
// 1-minute klines (the taker-buy volume field is the volume traded by buyers who hit the ask).
// Descriptive context only: one venue (Binance spot), no signal, no prediction.

export const CRYPTO_FLOW_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;
export type CryptoFlowSymbol = (typeof CRYPTO_FLOW_SYMBOLS)[number];

export function isCryptoFlowSymbol(value: string): value is CryptoFlowSymbol {
  return (CRYPTO_FLOW_SYMBOLS as readonly string[]).includes(value);
}

/** One closed 1-minute bar. delta = buyer-aggressor volume minus seller-aggressor volume (base asset units). */
export interface CryptoFlowPoint {
  /** Bar open time, epoch milliseconds. */
  t: number;
  close: number;
  volume: number;
  delta: number;
  /** Cumulative delta from the first bar of the window. */
  cum: number;
}

export interface CryptoFlowWindow {
  /** Minutes covered. */
  minutes: number;
  delta: number;
  volume: number;
  /** delta / volume as a percentage (-100 .. 100). */
  deltaPct: number;
  /** Share of the volume bought by aggressive buyers, percent. */
  buyPct: number;
  /** Percent change of the close over the window. */
  priceChangePct: number;
}

export interface CryptoFlowResponse {
  symbol: CryptoFlowSymbol;
  venue: "Binance spot";
  /** Open time of the last closed minute, epoch milliseconds. */
  asOf: number;
  lastPrice: number;
  windows: { m15: CryptoFlowWindow; h1: CryptoFlowWindow; h4: CryptoFlowWindow };
  /** Closed 1-minute points, oldest first (up to 240). */
  series: CryptoFlowPoint[];
}
