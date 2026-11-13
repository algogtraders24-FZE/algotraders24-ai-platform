// services/crypto-flow/binance.provider.ts
// The ONE real HTTP-calling function for Crypto Flow: the public Binance spot 1-minute klines
// (no key, read-only, market data only). data-api.binance.vision is Binance's market-data host and is
// reachable from regions where api.binance.com is restricted. The upstream fetch is cached by Next.js
// so a burst of page loads collapses to one request per symbol per cache window.
import "server-only";
import type { CryptoFlowSymbol } from "@/types/crypto-flow";
import type { RawKline } from "./compute";

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

const BASE_URL = "https://data-api.binance.vision";
const FETCH_TIMEOUT_MS = 8_000;
/** Seconds the upstream response is cached (one minute: the data is 1-minute bars). */
export const CRYPTO_FLOW_CACHE_SECONDS = 30;
/** 240 closed bars (4 hours) plus the open one. */
const KLINE_LIMIT = 241;

export type CryptoFlowFetch = typeof fetch;

export async function fetchBinanceKlines(symbol: CryptoFlowSymbol, fetchImpl: CryptoFlowFetch = fetch): Promise<RawKline[]> {
  const url = `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=1m&limit=${KLINE_LIMIT}`;
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
  if (!Array.isArray(json)) throw new CryptoFlowProviderError("invalid_response", "Market data host returned an unexpected shape");
  return json as RawKline[];
}
