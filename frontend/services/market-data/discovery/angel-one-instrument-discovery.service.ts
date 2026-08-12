// services/market-data/discovery/angel-one-instrument-discovery.service.ts
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Reuses Angel One's real, public, unauthenticated instrument
// scrip master - the exact same endpoint lib/market-data/instrument-
// catalog.ts's own header and angel-one.provider.ts's header already
// document and live-verified (2026-08-10/11) for this project's 6 hand-
// curated Indian entries: https://margincalculator.angelbroking.com/
// OpenAPI_File/files/OpenAPIScripMaster.json. No login/credentials
// required - this is Angel One's own published catalog, not invented.
//
// The real, confirmed field shapes for this file (from the same
// live-verified rows already cited in instrument-catalog.ts's RELIANCE/
// NIFTY 50/BANK NIFTY entries): `token`, `symbol` (e.g. "RELIANCE-EQ" for
// a cash equity, "Nifty 50"/"Nifty Bank" for the two confirmed indices),
// `name`, `exch_seg` ("NSE"), `instrumenttype` ("" for a cash equity,
// "AMXIDX" for the specific index variant this platform's existing
// entries use). Filtering to exactly these two instrumenttype values on
// the NSE segment mirrors the real, already-verified pattern this
// codebase established in D2.6.6 - never a guessed schema.
//
// The full scrip master is large (~150k rows, confirmed by D2.6.3/D2.6.6's
// own comments) - cached as ONE TtlCache entry (12h TTL, 48h stale-
// fallback grace window - longer than Binance's, since this payload is
// far more expensive to refetch) rather than an indexed store, per this
// sprint's own "no Redis/Kafka" constraint. A linear scan per query is
// acceptable at this platform's real query volume; documented as a known
// scaling limitation, not silently hidden.
import { TtlCache, systemClock, type Clock } from "@/lib/market-data/cache";
import type { DiscoveredCandidate, ProviderDiscoveryResult } from "@/types/instrument-discovery";

const PROVIDER_NAME = "angel-one";
const SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
const CACHE_KEY = "scripMaster";
const DEFAULT_TTL_MS = 12 * 60 * 60_000;
const DEFAULT_STALE_MAX_AGE_MS = 48 * 60 * 60_000;
const MAX_RESULTS = 25;
const ALLOWED_EXCHANGE_SEGMENTS = new Set(["NSE"]);
const ALLOWED_INSTRUMENT_TYPES = new Set(["", "AMXIDX"]);

interface AngelOneScripEntry {
  token?: string;
  symbol?: string;
  name?: string;
  exch_seg?: string;
  instrumenttype?: string;
}
interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type AngelOneDiscoveryFetch = (url: string) => Promise<FetchLikeResponse>;

export interface AngelOneInstrumentDiscoveryOptions {
  cacheTtlMs?: number;
  staleMaxAgeMs?: number;
  clock?: Clock;
  fetchImpl?: AngelOneDiscoveryFetch;
}

export class AngelOneInstrumentDiscoveryService {
  readonly name = PROVIDER_NAME;
  private readonly cache: TtlCache<AngelOneScripEntry[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: AngelOneDiscoveryFetch;
  private readonly cacheTtlMs: number;
  private readonly staleMaxAgeMs: number;

  constructor(options: AngelOneInstrumentDiscoveryOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.cache = new TtlCache<AngelOneScripEntry[]>(this.cacheTtlMs, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as AngelOneDiscoveryFetch);
    this.staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS;
  }

  async search(query: string): Promise<ProviderDiscoveryResult> {
    const q = query.trim().toUpperCase();
    if (!q) return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: false };

    // See binance-instrument-discovery.service.ts's identical comment -
    // TtlCache.get() would delete the expired entry before the
    // stale-fallback branch below could ever read it back.
    let entries = this.cache.getStale(CACHE_KEY, this.cacheTtlMs)?.value;
    let stale = false;
    if (!entries) {
      try {
        entries = await this.fetchScripMaster();
        this.cache.set(CACHE_KEY, entries);
      } catch (error) {
        const staleRead = this.cache.getStale(CACHE_KEY, this.staleMaxAgeMs);
        if (staleRead) {
          entries = staleRead.value;
          stale = true;
        } else {
          return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: true, reason: error instanceof Error ? error.message : "Angel One discovery failed" };
        }
      }
    }

    const candidates: DiscoveredCandidate[] = entries
      .filter((e): e is Required<Pick<AngelOneScripEntry, "token" | "symbol" | "name" | "exch_seg" | "instrumenttype">> & AngelOneScripEntry =>
        typeof e.token === "string" &&
        typeof e.symbol === "string" &&
        typeof e.name === "string" &&
        typeof e.exch_seg === "string" &&
        typeof e.instrumenttype === "string" &&
        ALLOWED_EXCHANGE_SEGMENTS.has(e.exch_seg) &&
        ALLOWED_INSTRUMENT_TYPES.has(e.instrumenttype),
      )
      .filter((e) => e.symbol.toUpperCase().includes(q) || e.name.toUpperCase().includes(q))
      .slice(0, MAX_RESULTS)
      .map((e) => ({
        provider: PROVIDER_NAME,
        providerSymbol: e.symbol,
        providerInstrumentId: e.token,
        displayName: e.name,
        exchange: "NSE",
        country: "IN",
        currency: "INR",
        assetClass: e.instrumenttype === "AMXIDX" ? ("index" as const) : ("equity" as const),
        marketCategory: e.instrumenttype === "AMXIDX" ? ("indices" as const) : ("stocks" as const),
        // Angel One's real, live adapter (angel-one.provider.ts) can serve
        // quote+candles for any real NSE equity/index once registered -
        // matches the exact capability the 6 hand-curated entries declare.
        capabilities: ["quote", "candles"] as const,
      }));

    return { provider: PROVIDER_NAME, candidates: candidates as DiscoveredCandidate[], stale, failed: false };
  }

  private async fetchScripMaster(): Promise<AngelOneScripEntry[]> {
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(SCRIP_MASTER_URL);
    } catch {
      throw new Error("Failed to reach Angel One scrip master");
    }
    if (!res.ok) throw new Error(`Angel One scrip master returned HTTP ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error("Angel One scrip master response was not valid JSON");
    }
    if (!Array.isArray(body)) throw new Error("Angel One scrip master response was not an array");
    return body as AngelOneScripEntry[];
  }
}
