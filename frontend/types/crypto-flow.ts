// types/crypto-flow.ts
// Crypto Flow - real buyer / seller aggressor delta from the public Binance 1-minute klines
// (the taker-buy volume field is the volume traded by buyers who hit the ask).
// Descriptive context only: one venue (Binance), no signal, no prediction.

export type CryptoFlowMarket = "spot" | "perp";
export type CryptoFlowGroup = "crypto" | "gold";

export interface CryptoFlowInstrument {
  /** Binance symbol, also the id used in the API. */
  symbol: string;
  /** Short display name, e.g. "BTC". */
  short: string;
  label: string;
  market: CryptoFlowMarket;
  group: CryptoFlowGroup;
  /** Base-asset unit shown next to deltas. */
  unit: string;
  /** Extra line shown on the card (what the instrument really is). */
  note?: string;
}

/**
 * The instruments. Crypto: the ten largest coins by market cap that trade against USDT on Binance spot (stablecoins skipped).
 * Gold and metals: the XAUUSDT / XAGUSDT USDⓈ-M perpetual futures (XAUUSDT does not exist on spot) and the gold-backed
 * PAXG token on spot, which trades thinly.
 */
export const CRYPTO_FLOW_INSTRUMENTS: readonly CryptoFlowInstrument[] = [
  { symbol: "BTCUSDT", short: "BTC", label: "Bitcoin", market: "spot", group: "crypto", unit: "BTC" },
  { symbol: "ETHUSDT", short: "ETH", label: "Ethereum", market: "spot", group: "crypto", unit: "ETH" },
  { symbol: "BNBUSDT", short: "BNB", label: "BNB", market: "spot", group: "crypto", unit: "BNB" },
  { symbol: "XRPUSDT", short: "XRP", label: "XRP", market: "spot", group: "crypto", unit: "XRP" },
  { symbol: "SOLUSDT", short: "SOL", label: "Solana", market: "spot", group: "crypto", unit: "SOL" },
  { symbol: "TRXUSDT", short: "TRX", label: "TRON", market: "spot", group: "crypto", unit: "TRX" },
  { symbol: "HYPEUSDT", short: "HYPE", label: "Hyperliquid", market: "spot", group: "crypto", unit: "HYPE" },
  { symbol: "DOGEUSDT", short: "DOGE", label: "Dogecoin", market: "spot", group: "crypto", unit: "DOGE" },
  { symbol: "LINKUSDT", short: "LINK", label: "Chainlink", market: "spot", group: "crypto", unit: "LINK" },
  { symbol: "ADAUSDT", short: "ADA", label: "Cardano", market: "spot", group: "crypto", unit: "ADA" },
  { symbol: "XAUUSDT", short: "XAU", label: "Gold (perpetual)", market: "perp", group: "gold", unit: "oz", note: "Binance USDⓈ-M perpetual futures, leveraged, trades on weekends" },
  { symbol: "XAGUSDT", short: "XAG", label: "Silver (perpetual)", market: "perp", group: "gold", unit: "oz", note: "Binance USDⓈ-M perpetual futures, leveraged, trades on weekends" },
  { symbol: "PAXGUSDT", short: "PAXG", label: "Gold token (PAXG)", market: "spot", group: "gold", unit: "PAXG", note: "Gold-backed token on spot: few trades, delta is noisy" },
] as const;

export const CRYPTO_FLOW_SYMBOLS: readonly string[] = CRYPTO_FLOW_INSTRUMENTS.map((i) => i.symbol);
export type CryptoFlowSymbol = string;

export function isCryptoFlowSymbol(value: string): boolean {
  return CRYPTO_FLOW_SYMBOLS.includes(value);
}

export function getCryptoFlowInstrument(symbol: string): CryptoFlowInstrument | undefined {
  return CRYPTO_FLOW_INSTRUMENTS.find((i) => i.symbol === symbol);
}

/** One closed 1-minute bar. delta = buyer-aggressor volume minus seller-aggressor volume (base asset units). */
export interface CryptoFlowPoint {
  /** Bar open time, epoch milliseconds. */
  t: number;
  close: number;
  volume: number;
  /** Number of trades in the bar. */
  trades: number;
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

/** Who has been the aggressor lately. Descriptive: it summarises what already traded, it is not a forecast. */
export type CryptoFlowSide = "buyers" | "sellers" | "balanced";
export type CryptoFlowStrength = "mild" | "moderate" | "strong";

export interface CryptoFlowBias {
  side: CryptoFlowSide;
  strength: CryptoFlowStrength | null;
  /** Weighted distance of the buyers' share from 50 %, in percentage points (positive = buyers). */
  score: number;
  /** True when the 15 min, 1 h and 4 h windows all lean the same way (each at least 2 points from 50 %). */
  consistent: boolean;
}

/** How much a delta can be trusted: from the number of trades per minute over the last 4 hours. */
export type CryptoFlowQualityLevel = "high" | "medium" | "thin";

export interface CryptoFlowQuality {
  level: CryptoFlowQualityLevel;
  medianTradesPerMinute: number;
  /** Minutes without a single trade in the window. */
  emptyMinutes: number;
}

export interface CryptoFlowResponse {
  symbol: string;
  venue: string;
  /** Open time of the last closed minute, epoch milliseconds. */
  asOf: number;
  lastPrice: number;
  windows: { m15: CryptoFlowWindow; h1: CryptoFlowWindow; h4: CryptoFlowWindow };
  bias: CryptoFlowBias;
  quality: CryptoFlowQuality;
  /** Closed 1-minute points, oldest first (up to 240). Omitted in the overview. */
  series?: CryptoFlowPoint[];
}

/** One row of the overview: an instrument that loaded, or one that is temporarily unavailable. */
export type CryptoFlowOverviewRow =
  | { symbol: string; status: "ok"; data: CryptoFlowResponse }
  | { symbol: string; status: "unavailable"; message: string };

export interface CryptoFlowOverview {
  rows: CryptoFlowOverviewRow[];
}

// ---------------------------------------------------------------------------------------------------------------
// Flow Zones: where buyers and sellers have been trading (volume profile split by aggressor side) and where the
// resting orders sit (order-book walls). Descriptive: it shows what already traded and what is resting now.
// ---------------------------------------------------------------------------------------------------------------

export type CryptoFlowLookback = "4h" | "24h" | "7d";

export interface CryptoFlowLookbackConfig {
  id: CryptoFlowLookback;
  label: string;
  /** Binance kline interval used for this lookback (one request, closed bars only). */
  interval: "1m" | "5m" | "15m";
  /** Minutes per bar. */
  barMinutes: number;
  /** Closed bars wanted. */
  bars: number;
  /** Price bucket size as a percentage of the last price. */
  stepPct: number;
}

export const CRYPTO_FLOW_LOOKBACKS: readonly CryptoFlowLookbackConfig[] = [
  { id: "4h", label: "4 hours", interval: "1m", barMinutes: 1, bars: 240, stepPct: 0.05 },
  { id: "24h", label: "24 hours", interval: "5m", barMinutes: 5, bars: 288, stepPct: 0.1 },
  { id: "7d", label: "7 days", interval: "15m", barMinutes: 15, bars: 672, stepPct: 0.25 },
] as const;

export function getCryptoFlowLookback(id: string): CryptoFlowLookbackConfig | undefined {
  return CRYPTO_FLOW_LOOKBACKS.find((l) => l.id === id);
}

/** One price bucket of the profile. buy / sell are base-asset volume bought / sold by aggressors. */
export interface CryptoFlowProfileBucket {
  /** Bucket centre price. */
  price: number;
  buy: number;
  sell: number;
}

export interface CryptoFlowZone {
  /** Bucket centre price. */
  price: number;
  /** Distance from the last price, percent (negative = below). */
  distancePct: number;
  /** The bucket's net imbalance (buyers minus sellers, or the reverse) as a percentage of all volume in the lookback. */
  netSharePct: number;
}

export interface CryptoFlowWall {
  /** Centre price of the 0.2 % band. */
  price: number;
  distancePct: number;
  /** Resting orders in the band, in quote currency (USDT). */
  notional: number;
}

export interface CryptoFlowBook {
  bids: CryptoFlowWall[];
  asks: CryptoFlowWall[];
  /** How far from the price each side of the downloaded book reaches (the smaller of the two), percent. */
  coveragePct: number;
  /** (bids - asks) / (bids + asks) within that coverage, percent. */
  imbalancePct: number;
}

export type CryptoFlowValueState = "inside" | "above" | "below";

export interface CryptoFlowZones {
  symbol: string;
  venue: string;
  lookback: CryptoFlowLookback;
  /** Open time of the last closed bar, epoch ms. */
  asOf: number;
  lastPrice: number;
  /** Bucket size, percent of the last price. */
  stepPct: number;
  /** Trades per minute over the lookback; below 20 the profile is too thin to read. */
  tradesPerMinute: number;
  thin: boolean;
  /** Empty when thin. Ordered from the lowest price to the highest. */
  profile: CryptoFlowProfileBucket[];
  poc: CryptoFlowZone | null;
  valueAreaLow: number | null;
  valueAreaHigh: number | null;
  state: CryptoFlowValueState | null;
  buyerZone: CryptoFlowZone | null;
  sellerZone: CryptoFlowZone | null;
  /** Null when the order book could not be loaded or the instrument is thin. */
  book: CryptoFlowBook | null;
}

// ---- forward scoreboard (see services/crypto-flow/scoreboard.ts for the fixed rules) ----
export type CryptoFlowScoreVerdict = "COLLECTING" | "POSITIVE ON THIS HISTORY" | "NEGATIVE ON THIS HISTORY" | "NO EDGE SHOWN";

export interface CryptoFlowScoreRow {
  n: number;
  meanR: number | null;
  hitPct: number | null;
  t: number | null;
  verdict: CryptoFlowScoreVerdict;
}

export interface CryptoFlowScoreboard {
  rows: Array<{ symbol: string; side: "buyer" | "seller"; untouched: number } & CryptoFlowScoreRow>;
  pooled: { buyer: CryptoFlowScoreRow; seller: CryptoFlowScoreRow };
  open: number;
  done: number;
  since: string | null;
}
