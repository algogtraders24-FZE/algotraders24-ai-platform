// lib/market-data/providers/angel-one.provider.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. Implements the existing, UNMODIFIED MarketDataProvider/
// SnapshotProvider/TimeSeriesProvider interfaces (types/market-data-
// provider.ts) - a drop-in for MarketDataService's provider array, no
// changes above the provider layer.
//
// *** LIVE VERIFICATION STATUS - READ BEFORE TRUSTING THIS FILE ***
// This adapter's request/response shapes are built from Angel One
// SmartAPI's own published documentation (loginByPassword, getLtpData,
// getCandleData) - a real, stable, versioned public contract.
// D2.6.3-D2.6.5 deliberately never attempted a live authenticated call
// (treated as an external, hard-to-reverse action against a real
// brokerage account, reserved for the user's own explicit go-ahead).
// Sprint D2.6.6 obtained that explicit go-ahead and ran a real,
// authenticated live smoke test (scripts/validate-indian-market-data.ts,
// gated behind RUN_LIVE_ANGEL_ONE_SMOKE_TEST=1, never on by default) on
// 2026-08-11: authentication, NIFTY 50 quote, NIFTY Bank quote, a real
// NSE equity (RELIANCE) quote, historical daily candles, and timestamp
// freshness all PASSED against the real API using this project's own
// real credentials - read-only, no order/execution call was ever made
// or exists in this file. The main test suite still runs entirely
// against fake/injected HTTP responses by default (no live network in
// CI/regular regression runs) - see scripts/validate-multi-provider-router.ts
// and scripts/validate-indian-market-data.ts. `isConfigured()` honestly
// reports whether real credentials exist; nothing here fabricates a
// successful login or a live quote when they don't.
//
// The symbol/token mapping IS live-verified (unauthenticated): Angel
// One publishes a public instrument scrip master (no login required) at
// https://margincalculator.angelbroking.com/OpenAPI_File/files/
// OpenAPIScripMaster.json - this was fetched live on 2026-08-10 to
// confirm the real token/exchange values for NIFTY 50 and RELIANCE (see
// lib/market-data/instrument-catalog.ts's entries and their comments).
//
// Secrets discipline: the API key, TOTP code, JWT, and refresh token are
// NEVER logged, NEVER included in a thrown error message, and NEVER
// echoed anywhere - matching Twelve Data/Alpha Vantage's existing
// "the key lives in the request, never in a log" discipline, extended
// here to every derived credential a session produces.
import type {
  MarketDataProvider,
  SnapshotProvider,
  TimeSeriesProvider,
  MarketContextRequest,
  MarketContextResult,
  MarketEvidenceItem,
} from "@/types/market-data-provider";
import type { MarketCategory } from "@/types/market";
import type { MarketSnapshot, MarketStatus } from "@/types/market-snapshot";
import type { Candle, TimeSeriesRequest } from "@/types/market-candle";
import type { MarketDataCapability } from "@/types/canonical-instrument";
import { getMarket } from "../market-registry";
import { mappingsForProvider } from "../instrument-catalog";
import { loadAngelOneEnv, type AngelOneEnv } from "../env";
import { generateTotp } from "../angel-one-totp";
import { MarketDataProviderError } from "../errors";
import { TtlCache, systemClock, type Clock } from "../cache";

const PROVIDER_NAME = "angel-one";
const BASE_URL = "https://apiconnect.angelbroking.com";
const LOGIN_PATH = "/rest/auth/angelbroking/user/v1/loginByPassword";
const LTP_PATH = "/rest/secure/angelbroking/order/v1/getLtpData";
const CANDLE_PATH = "/rest/secure/angelbroking/historical/v1/getCandleData";
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CANDLE_CACHE_TTL_MS = 5 * 60_000;
// SmartAPI JWTs are documented as short-lived; re-authenticate well
// before the session could plausibly expire rather than reacting to a
// 401 after the fact - a conservative, documented policy, not a
// confirmed-live value.
const SESSION_TTL_MS = 6 * 60 * 60_000;

interface SymbolSpec {
  exchange: string;
  tradingsymbol: string;
  symboltoken: string;
  assetClass: MarketCategory;
  capabilities: MarketDataCapability[];
}

// Built once, at module load, directly from the catalog - this adapter
// has no prior frozen symbol table to preserve (see the catalog file's
// header for the reasoning). Angel One's `exchange` is derived from
// each instrument's own `exchange` field; a mapping with no exchange
// set is a real data gap, never guessed.
const SYMBOL_MAP: Record<string, SymbolSpec> = Object.fromEntries(
  mappingsForProvider(PROVIDER_NAME)
    .filter(({ instrument, mapping }) => instrument.exchange && mapping.providerInstrumentId)
    .map(({ instrument, mapping }) => [
      instrument.id,
      {
        exchange: instrument.exchange as string,
        tradingsymbol: mapping.providerSymbol,
        symboltoken: mapping.providerInstrumentId as string,
        assetClass: instrument.marketCategory ?? "indices",
        capabilities: mapping.supportedCapabilities,
      },
    ]),
);

// SignalTimeframe -> Angel One's documented interval enum.
const INTERVAL_MAP: Record<string, string> = {
  "1m": "ONE_MINUTE",
  "5m": "FIVE_MINUTE",
  "15m": "FIFTEEN_MINUTE",
  "30m": "THIRTY_MINUTE",
  "1h": "ONE_HOUR",
  "4h": "FOUR_HOUR",
  "1d": "ONE_DAY",
};
const DEFAULT_INTERVAL = "1d";
const DEFAULT_OUTPUT_SIZE = 100;

interface Session {
  jwtToken: string;
  obtainedAtMs: number;
}

/** Structured, provider-neutral quote parsed from Angel One's getLtpData. Never leaves this file. */
export interface ParsedQuote {
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
}

interface AngelOneEnvelope<T> {
  status?: boolean;
  message?: string;
  errorcode?: string;
  data?: T;
}
interface LoginData {
  jwtToken?: string;
  refreshToken?: string;
  feedToken?: string;
}
interface LtpData {
  exchange?: string;
  tradingsymbol?: string;
  symboltoken?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  ltp?: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network. */
export type AngelOneFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchLikeResponse>;

export interface AngelOneProviderOptions {
  cacheTtlMs?: number;
  candleCacheTtlMs?: number;
  clock?: Clock;
  fetchImpl?: AngelOneFetch;
  /** Injectable for tests only - production always uses the real generateTotp(). */
  totpGenerator?: (secret: string, atMs: number) => Promise<string>;
}

function toFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function fmt(n: number): string {
  return Number.parseFloat(n.toPrecision(12)).toString();
}

export class AngelOneProvider implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name = PROVIDER_NAME;
  private readonly env: AngelOneEnv | null;
  private readonly cache: TtlCache<ParsedQuote>;
  private readonly candleCache: TtlCache<Candle[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: AngelOneFetch;
  private readonly totpGenerator: (secret: string, atMs: number) => Promise<string>;
  private session: Session | null = null;

  constructor(options: AngelOneProviderOptions = {}) {
    this.env = loadAngelOneEnv();
    this.clock = options.clock ?? systemClock;
    this.cache = new TtlCache<ParsedQuote>(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, this.clock);
    this.candleCache = new TtlCache<Candle[]>(options.candleCacheTtlMs ?? DEFAULT_CANDLE_CACHE_TTL_MS, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as AngelOneFetch);
    this.totpGenerator = options.totpGenerator ?? generateTotp;
  }

  isConfigured(): boolean {
    return this.env !== null;
  }

  supportedSymbols(): string[] {
    return Object.keys(SYMBOL_MAP);
  }

  private resolveSymbol(symbol: string, requiredCapability: MarketDataCapability): SymbolSpec {
    const spec = SYMBOL_MAP[symbol];
    if (!spec) {
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${symbol}" is not mapped for ${PROVIDER_NAME} (supported: ${Object.keys(SYMBOL_MAP).join(", ")})`,
        PROVIDER_NAME,
      );
    }
    if (!spec.capabilities.includes(requiredCapability)) {
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${symbol}" is mapped for ${PROVIDER_NAME} but does not declare "${requiredCapability}" capability`,
        PROVIDER_NAME,
      );
    }
    return spec;
  }

  private headers(env: AngelOneEnv, jwtToken?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      // Documented as required by SmartAPI but not meaningfully
      // verifiable by the server for a server-to-server call from this
      // platform's own infrastructure - real, fixed placeholders, never
      // fabricated USER data.
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": env.apiKey,
    };
    if (jwtToken) h.Authorization = `Bearer ${jwtToken}`;
    return h;
  }

  // Never throws a raw fetch/parse error that could echo a request body
  // (which carries the PIN/TOTP on login, or the JWT on every other
  // call) - only generic, credential-free messages leave this method.
  private async request<T>(path: string, body: unknown, jwtToken: string | undefined, env: AngelOneEnv): Promise<AngelOneEnvelope<T>> {
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(`${BASE_URL}${path}`, { method: "POST", headers: this.headers(env, jwtToken), body: JSON.stringify(body) });
    } catch {
      throw new MarketDataProviderError("http_error", `Failed to reach ${PROVIDER_NAME}`, PROVIDER_NAME);
    }

    if (!res.ok) {
      const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : "http_error";
      throw new MarketDataProviderError(kind, `${PROVIDER_NAME} returned HTTP ${res.status}`, PROVIDER_NAME);
    }

    let envelope: AngelOneEnvelope<T>;
    try {
      envelope = (await res.json()) as AngelOneEnvelope<T>;
    } catch {
      throw new MarketDataProviderError("invalid_response", `${PROVIDER_NAME} response was not valid JSON`, PROVIDER_NAME);
    }

    if (envelope.status !== true) {
      // Angel One reports auth failures (bad TOTP/expired session) with
      // status:false and a real errorcode - classify by errorcode
      // prefix, never by string-matching the human message.
      const code = envelope.errorcode ?? "";
      const kind = code.startsWith("AB1") || code.startsWith("AB2") ? "auth" : "invalid_response";
      throw new MarketDataProviderError(kind, `${PROVIDER_NAME} error (${code || "unknown"}): ${envelope.message ?? "no message"}`, PROVIDER_NAME);
    }
    return envelope;
  }

  // Real RFC 6238 TOTP + documented loginByPassword contract - see the
  // file header for why this has never been exercised against the real
  // API this sprint. A session is cached in memory only (never
  // persisted) and re-obtained once SESSION_TTL_MS has passed.
  private async ensureSession(): Promise<{ jwtToken: string; env: AngelOneEnv }> {
    if (!this.env) {
      throw new MarketDataProviderError("unconfigured", `${PROVIDER_NAME} is not configured (missing API_KEY/CLIENT_CODE/PIN/TOTP_SECRET)`, PROVIDER_NAME);
    }
    const env = this.env;
    if (this.session && this.clock.now() - this.session.obtainedAtMs < SESSION_TTL_MS) {
      return { jwtToken: this.session.jwtToken, env };
    }

    const totp = await this.totpGenerator(env.totpSecret, this.clock.now());
    const envelope = await this.request<LoginData>(LOGIN_PATH, { clientcode: env.clientCode, password: env.pin, totp }, undefined, env);
    const jwtToken = envelope.data?.jwtToken;
    if (!jwtToken) {
      throw new MarketDataProviderError("auth", `${PROVIDER_NAME} login did not return a session token`, PROVIDER_NAME);
    }
    this.session = { jwtToken, obtainedAtMs: this.clock.now() };
    return { jwtToken, env };
  }

  private async getParsedQuote(spec: SymbolSpec): Promise<ParsedQuote> {
    const cacheKey = `${spec.exchange}:${spec.symboltoken}`;
    let quote = this.cache.get(cacheKey);
    if (!quote) {
      const { jwtToken, env } = await this.ensureSession();
      const envelope = await this.request<LtpData>(
        LTP_PATH,
        { exchange: spec.exchange, tradingsymbol: spec.tradingsymbol, symboltoken: spec.symboltoken },
        jwtToken,
        env,
      );
      const close = toFiniteNumber(envelope.data?.ltp ?? envelope.data?.close);
      if (close === undefined) {
        throw new MarketDataProviderError("invalid_response", `${PROVIDER_NAME} response did not contain a parseable price`, PROVIDER_NAME);
      }
      quote = { price: close, close, open: toFiniteNumber(envelope.data?.open), high: toFiniteNumber(envelope.data?.high), low: toFiniteNumber(envelope.data?.low) };
      this.cache.set(cacheKey, quote);
    }
    return quote;
  }

  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    const spec = this.resolveSymbol(request.symbol, "quote");
    const quote = await this.getParsedQuote(spec);
    const retrievedAt = new Date(this.clock.now()).toISOString();

    const evidence: MarketEvidenceItem[] = [{ claim: `Spot price: ${fmt(quote.close)} INR`, source: PROVIDER_NAME, asOf: retrievedAt }];
    if (quote.open !== undefined && quote.high !== undefined && quote.low !== undefined) {
      evidence.push({
        claim: `Session OHLC: open ${fmt(quote.open)}, high ${fmt(quote.high)}, low ${fmt(quote.low)}, close ${fmt(quote.close)} INR`,
        source: PROVIDER_NAME,
        asOf: retrievedAt,
      });
    }

    return { symbol: request.symbol, provider: PROVIDER_NAME, retrievedAt, evidence };
  }

  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    const spec = this.resolveSymbol(request.symbol, "quote");
    const quote = await this.getParsedQuote(spec);
    const retrievedAt = new Date(this.clock.now()).toISOString();
    // NSE has real market hours this platform has no verified feed for
    // here - "unknown" is the honest status, never a guessed open/closed.
    const marketStatus: MarketStatus = "unknown";

    return {
      symbol: request.symbol,
      name: getMarket(request.symbol)?.name,
      assetClass: spec.assetClass,
      price: quote.close,
      ohlc:
        quote.open !== undefined && quote.high !== undefined && quote.low !== undefined
          ? { open: quote.open, high: quote.high, low: quote.low, close: quote.close }
          : undefined,
      quoteCurrency: "INR",
      timestamp: retrievedAt,
      timezone: "Asia/Kolkata",
      marketStatus,
      provider: PROVIDER_NAME,
      retrievedAt,
      providerSymbol: spec.tradingsymbol,
    };
  }

  async getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]> {
    const spec = this.resolveSymbol(request.symbol, "candles");
    const interval = INTERVAL_MAP[request.interval ?? DEFAULT_INTERVAL];
    if (!interval) {
      throw new MarketDataProviderError("invalid_response", `${PROVIDER_NAME} does not support interval "${request.interval}"`, PROVIDER_NAME);
    }
    const size = request.outputSize ?? DEFAULT_OUTPUT_SIZE;
    const cacheKey = `${spec.symboltoken}|${interval}|${size}`;

    let candles = this.candleCache.get(cacheKey);
    if (!candles) {
      const { jwtToken, env } = await this.ensureSession();
      const { fromdate, todate } = this.candleWindow(interval, size);
      const envelope = await this.request<Array<[string, number, number, number, number, number]>>(
        CANDLE_PATH,
        { exchange: spec.exchange, symboltoken: spec.symboltoken, interval, fromdate, todate },
        jwtToken,
        env,
      );
      const rows = envelope.data ?? [];
      candles = rows
        .filter((row): row is [string, number, number, number, number, number] => Array.isArray(row) && row.length >= 5 && typeof row[0] === "string")
        .map(([datetime, open, high, low, close, volume]) => ({ datetime: new Date(datetime).toISOString(), open, high, low, close, volume }));
      this.candleCache.set(cacheKey, candles);
    }
    return candles;
  }

  // Best-effort fromdate/todate window in the documented "YYYY-MM-DD
  // HH:mm" IST-local format, sized generously for the requested candle
  // count - unverified against a real response (see file header); a
  // future sprint with live access should confirm this window actually
  // yields exactly the requested count rather than trusting this
  // estimate.
  private candleWindow(interval: string, size: number): { fromdate: string; todate: string } {
    const stepMs: Record<string, number> = {
      ONE_MINUTE: 60_000,
      FIVE_MINUTE: 5 * 60_000,
      FIFTEEN_MINUTE: 15 * 60_000,
      THIRTY_MINUTE: 30 * 60_000,
      ONE_HOUR: 60 * 60_000,
      FOUR_HOUR: 4 * 60 * 60_000,
      ONE_DAY: 24 * 60 * 60_000,
    };
    const spanMs = (stepMs[interval] ?? stepMs.ONE_DAY) * size;
    const to = new Date(this.clock.now());
    const from = new Date(to.getTime() - spanMs);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
    return { fromdate: fmtDate(from), todate: fmtDate(to) };
  }
}
