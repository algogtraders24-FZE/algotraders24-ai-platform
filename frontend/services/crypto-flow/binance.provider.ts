// services/crypto-flow/binance.provider.ts
// The ONE real HTTP-calling function for Crypto Flow: the public Binance spot 1-minute klines
// (no key, read-only, market data only). data-api.binance.vision is Binance's market-data host and is
// reachable from regions where api.binance.com is restricted. The upstream fetch is cached by Next.js
// so a burst of page loads collapses to one request per symbol per cache window.
import "server-only";
import type { CryptoFlowMarket } from "@/types/crypto-flow";
import type { RawKline } from "./compute";
import type { RawBook } from "./zones";

export type CryptoFlowProviderErrorKind = "http_error" | "invalid_response" | "timeout" | "unknown";

export class CryptoFlowProviderError extends Error {
  constructor(
    public readonly kind: CryptoFlowProviderErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CryptoFlowProviderError";
  }
}

/** Spot: data-api.binance.vision (Binance market-data host, reachable where api.binance.com is restricted). Perpetual futures: fapi.binance.com. */
const BASE_URL: Record<CryptoFlowMarket, string> = { spot: "https://data-api.binance.vision", perp: "https://fapi.binance.com" };
const KLINE_PATH: Record<CryptoFlowMarket, string> = { spot: "/api/v3/klines", perp: "/fapi/v1/klines" };
const FETCH_TIMEOUT_MS = 8_000;
/** Seconds the upstream response is cached (one minute: the data is 1-minute bars). */
export const CRYPTO_FLOW_CACHE_SECONDS = 30;
/** 240 closed bars (4 hours) plus the open one. */
const KLINE_LIMIT = 241;

export type CryptoFlowFetch = typeof fetch;

async function getJson(url: string, fetchImpl: CryptoFlowFetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: CRYPTO_FLOW_CACHE_SECONDS },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new CryptoFlowProviderError(timedOut ? "timeout" : "unknown", "Could not reach the market data host", error);
  }
  if (!res.ok) throw new CryptoFlowProviderError("http_error", `Market data host returned HTTP ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (error) {
    throw new CryptoFlowProviderError("invalid_response", "Market data host returned invalid JSON", error);
  }
  return json;
}

export async function fetchBinanceKlines(
  symbol: string,
  market: CryptoFlowMarket = "spot",
  fetchImpl: CryptoFlowFetch = fetch,
  interval: string = "1m",
  limit: number = KLINE_LIMIT,
  startTime?: number,
): Promise<RawKline[]> {
  const start = startTime !== undefined ? `&startTime=${Math.floor(startTime)}` : "";
  const url = `${BASE_URL[market]}${KLINE_PATH[market]}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}${start}`;
  const json = await getJson(url, fetchImpl);
  if (!Array.isArray(json)) throw new CryptoFlowProviderError("invalid_response", "Market data host returned an unexpected shape");
  return json as RawKline[];
}

const DEPTH_PATH: Record<CryptoFlowMarket, string> = { spot: "/api/v3/depth", perp: "/fapi/v1/depth" };

/** The order book (up to 1000 levels per side). Resting orders, not trades. */
export async function fetchBinanceDepth(symbol: string, market: CryptoFlowMarket = "spot", fetchImpl: CryptoFlowFetch = fetch): Promise<RawBook> {
  const url = `${BASE_URL[market]}${DEPTH_PATH[market]}?symbol=${encodeURIComponent(symbol)}&limit=1000`;
  const json = (await getJson(url, fetchImpl)) as Partial<RawBook> | null;
  if (!json || !Array.isArray(json.bids) || !Array.isArray(json.asks)) throw new CryptoFlowProviderError("invalid_response", "Market data host returned an unexpected shape");
  return { bids: json.bids, asks: json.asks };
}
