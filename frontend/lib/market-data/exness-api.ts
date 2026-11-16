// lib/market-data/exness-api.ts
// Read-only client for the Exness Trading API (https://www.exness-api.com): signed GET requests only.
// There is NO order, position or payment call anywhere in this file, and never will be.
//
// Used by Mt5Provider as the PRIMARY source for candles and quotes; any failure here
// (disabled, misconfigured, rate limited, blocked, network, unexpected shape) makes the
// provider fall back to the self-hosted VPS bridge, so a problem with this API can never
// take the platform's market data down.
//
// Protocol (from the public docs): every request carries EXN-* headers; EXN-DATA is the
// base64url JSON of {api_key, idempotency_key, timestamp, sign_version, method, path, body_hash}
// and EXN-SIGN is the Ed25519 signature over those exact JSON bytes. The access point for an
// account is discovered once through the Gateway host and cached (discovery is rate limited).
// The key must be a "Trading read access" key; the secret is read from the server environment
// only and is never logged, returned or placed in a URL.
import { createHash, createPrivateKey, sign as edSign, type KeyObject } from "node:crypto";
import type { Clock } from "./cache";
import { systemClock } from "./cache";
import { loadExnessApiEnv, type ExnessApiEnv } from "./env";

const USER_AGENT = "AT24-ReadOnlyClient/0.1 (own-account market data)";
const ACCESS_POINT_TTL_MS = 6 * 60 * 60 * 1000;
const BLOCK_AFTER_FAILURE_MS = 60_000;
const MAX_CANDLES_PER_REQUEST = 1000;

/** Bridge-style interval -> Exness timeframe. Anything else is not served here (the caller falls back to the bridge). */
const TIMEFRAME_MAP: Record<string, string> = {
  "1m": "M1",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "4h": "H4",
  "1d": "D1",
  "1w": "W1",
};

export interface ExnessCandle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExnessQuote {
  bid: number;
  ask: number;
  providerTimestamp: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type ExnessFetch = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<FetchLikeResponse>;

export class ExnessApiError extends Error {
  constructor(readonly kind: "disabled" | "blocked" | "auth" | "rate_limit" | "http" | "shape" | "unsupported", message: string) {
    super(message);
    this.name = "ExnessApiError";
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Accepts the 128-hex key Exness generates (32-byte seed + 32-byte public half) or a bare 64-hex seed. */
export function loadEd25519PrivateKey(raw: string): KeyObject {
  const flat = raw.replace(/\s+/g, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(flat) || (flat.length !== 128 && flat.length !== 64)) {
    throw new ExnessApiError("auth", "Exness private key is not a 64/128-character hex value");
  }
  const seed = Buffer.from(flat.slice(0, 64), "hex");
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), format: "der", type: "pkcs8" });
}

export function signedHeaders(key: KeyObject, apiKey: string, pathWithQuery: string, nowMs: number): Record<string, string> {
  const payload = {
    api_key: apiKey,
    idempotency_key: "",
    timestamp: nowMs,
    sign_version: 1,
    method: "GET",
    path: pathWithQuery,
    body_hash: b64url(createHash("sha256").update("").digest()),
  };
  const data = Buffer.from(JSON.stringify(payload), "utf-8");
  const signature = edSign(null, data, key);
  return {
    "EXN-API-KEY": apiKey,
    "EXN-IDEMPOTENCY-KEY": "",
    "EXN-TIMESTAMP": String(nowMs),
    "EXN-SIGN-VERSION": "1",
    "EXN-DATA": b64url(data),
    "EXN-SIGN": b64url(signature),
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
}

function isoNoMillis(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function finite(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export interface ExnessApiClientOptions {
  env: ExnessApiEnv | null;
  fetchImpl?: ExnessFetch;
  clock?: Clock;
}

export class ExnessApiClient {
  private readonly env: ExnessApiEnv | null;
  private readonly fetchImpl: ExnessFetch;
  private readonly clock: Clock;
  private key: KeyObject | null = null;
  private accessPoint: { url: string; at: number } | null = null;
  private blockedUntil = 0;

  constructor(options: ExnessApiClientOptions) {
    this.env = options.env;
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as ExnessFetch);
    this.clock = options.clock ?? systemClock;
  }

  isEnabled(): boolean {
    return this.env !== null;
  }

  private getKey(env: ExnessApiEnv): KeyObject {
    if (!this.key) this.key = loadEd25519PrivateKey(env.privateKey);
    return this.key;
  }

  private async get(base: string, pathWithQuery: string): Promise<unknown> {
    const env = this.env;
    if (!env) throw new ExnessApiError("disabled", "Exness API is not enabled");
    const now = this.clock.now();
    if (now < this.blockedUntil) throw new ExnessApiError("blocked", "Exness API temporarily paused after a failure");

    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(base + pathWithQuery, { method: "GET", headers: signedHeaders(this.getKey(env), env.apiKey, pathWithQuery, now) });
    } catch (error) {
      if (error instanceof ExnessApiError) throw error;
      this.blockedUntil = now + BLOCK_AFTER_FAILURE_MS;
      throw new ExnessApiError("http", "Failed to reach the Exness API");
    }
    if (res.status === 429) {
      this.blockedUntil = now + BLOCK_AFTER_FAILURE_MS;
      throw new ExnessApiError("rate_limit", "Exness API rate limit");
    }
    if (res.status === 401 || res.status === 403) {
      this.blockedUntil = now + BLOCK_AFTER_FAILURE_MS;
      throw new ExnessApiError("auth", `Exness API rejected the request (HTTP ${res.status})`);
    }
    if (!res.ok) {
      this.blockedUntil = now + BLOCK_AFTER_FAILURE_MS;
      throw new ExnessApiError("http", `Exness API returned HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch {
      throw new ExnessApiError("shape", "Exness API response was not valid JSON");
    }
  }

  private accessPointInFlight: Promise<string> | null = null;

  private async getAccessPoint(): Promise<string> {
    const env = this.env;
    if (!env) throw new ExnessApiError("disabled", "Exness API is not enabled");
    const now = this.clock.now();
    if (this.accessPoint && now - this.accessPoint.at < ACCESS_POINT_TTL_MS) return this.accessPoint.url;
    // discovery is rate limited: concurrent callers share one request
    if (!this.accessPointInFlight) {
      this.accessPointInFlight = (async () => {
        try {
          const body = (await this.get(env.gatewayUrl, `/v1/trading/access-point?account_id=${encodeURIComponent(env.accountId)}`)) as { access_point?: unknown };
          if (typeof body.access_point !== "string" || !/^https:\/\//.test(body.access_point)) {
            throw new ExnessApiError("shape", "Exness access point response is invalid");
          }
          const url = body.access_point.replace(/\/+$/, "");
          this.accessPoint = { url, at: this.clock.now() };
          return url;
        } finally {
          this.accessPointInFlight = null;
        }
      })();
    }
    return this.accessPointInFlight;
  }

  private candlesPath(instrument: string, timeframe: string, count: number, priceType: "bid" | "both", fromIso?: string): string {
    const env = this.env as ExnessApiEnv;
    const params = new URLSearchParams({
      instrument,
      timeframe,
      price_type: priceType,
      count: String(-count), // negative count = candles before `from`
      from: fromIso ?? isoNoMillis(this.clock.now()),
    });
    return `/v1/market-data/accounts/${encodeURIComponent(env.accountId)}/candles?${params.toString()}`;
  }

  /** Candles, oldest first, in the same shape the VPS bridge returns. Throws ExnessApiError on anything unexpected. */
  async getCandles(instrument: string, interval: string, outputSize: number): Promise<ExnessCandle[]> {
    const timeframe = TIMEFRAME_MAP[interval];
    if (!timeframe) throw new ExnessApiError("unsupported", `Interval "${interval}" is not served by the Exness API client`);
    if (outputSize > MAX_CANDLES_PER_REQUEST) throw new ExnessApiError("unsupported", "Requested more candles than one Exness page");
    return this.fetchCandlePage(timeframe, instrument, Math.max(1, outputSize));
  }

  private async fetchCandlePage(timeframe: string, instrument: string, count: number, fromIso?: string): Promise<ExnessCandle[]> {
    const base = await this.getAccessPoint();
    const body = (await this.get(base, this.candlesPath(instrument, timeframe, count, "bid", fromIso))) as { candles?: unknown };
    if (!Array.isArray(body.candles)) throw new ExnessApiError("shape", "Exness candles response has no candles array");
    const out: ExnessCandle[] = [];
    for (const row of body.candles as Array<Record<string, unknown>>) {
      const open = finite(row.open);
      const high = finite(row.high);
      const low = finite(row.low);
      const close = finite(row.close);
      if (typeof row.time !== "string" || open === undefined || high === undefined || low === undefined || close === undefined) continue;
      out.push({ datetime: row.time, open, high, low, close, volume: finite(row.volume) ?? 0 });
    }
    if (out.length === 0) throw new ExnessApiError("shape", "Exness returned no usable candles");
    return out;
  }

  /**
   * Up to `total` candles ending now, fetched one page at a time (each page ends where the next begins), oldest first, de-duplicated by time.
   * The first page must succeed; if a later page fails the candles collected so far are returned (older history is simply shorter).
   */
  async getCandlesPaged(instrument: string, interval: string, total: number): Promise<ExnessCandle[]> {
    const timeframe = TIMEFRAME_MAP[interval];
    if (!timeframe) throw new ExnessApiError("unsupported", `Interval "${interval}" is not served by the Exness API client`);
    const byTime = new Map<string, ExnessCandle>();
    let fromIso: string | undefined;
    for (let page = 0; byTime.size < total && page < 40; page++) {
      let rows: ExnessCandle[];
      try {
        rows = await this.fetchCandlePage(timeframe, instrument, Math.min(MAX_CANDLES_PER_REQUEST, total - byTime.size + 1), fromIso);
      } catch (error) {
        if (page === 0) throw error;
        break;
      }
      const before = byTime.size;
      for (const r of rows) byTime.set(r.datetime, r);
      if (byTime.size === before) break; // no progress: the start of the history
      const oldest = rows.reduce((a, b) => (Date.parse(a.datetime) <= Date.parse(b.datetime) ? a : b));
      fromIso = isoNoMillis(Date.parse(oldest.datetime));
      if (rows.length < 50) break;
    }
    return [...byTime.values()].sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime)).slice(-total);
  }

  /** Latest bid/ask taken from the most recent M1 candle (both sides). Its timestamp is that candle's open time, so it can be up to a minute old. */
  async getQuote(instrument: string): Promise<ExnessQuote> {
    const base = await this.getAccessPoint();
    const body = (await this.get(base, this.candlesPath(instrument, "M1", 1, "both"))) as { candles?: unknown };
    const row = Array.isArray(body.candles) ? (body.candles as Array<Record<string, unknown>>).at(-1) : undefined;
    const bidSide = row?.bid as Record<string, unknown> | undefined;
    const askSide = row?.ask as Record<string, unknown> | undefined;
    const bid = finite(bidSide?.close);
    const ask = finite(askSide?.close);
    if (!row || typeof row.time !== "string" || bid === undefined || ask === undefined) {
      throw new ExnessApiError("shape", "Exness quote response is missing bid/ask/time");
    }
    return { bid, ask, providerTimestamp: row.time };
  }
}

let sharedClient: ExnessApiClient | null = null;

/** One client per server instance, so the access point is discovered once and the circuit breaker is shared by every caller. */
export function getSharedExnessClient(): ExnessApiClient {
  if (!sharedClient) sharedClient = new ExnessApiClient({ env: loadExnessApiEnv() });
  return sharedClient;
}
