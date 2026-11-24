// services/algo-test/historical-data/exness-provider.ts
// Historical bars for Algo Testing straight from the Exness API, fetched page by page (1,000 candles a page) so a test can span up to two years
// instead of the ~14 days one Twelve Data request allows. Same HistoricalDataProvider contract as the other providers: bars are validated, nothing
// is invented, and the source is named in the result. When the Exness API is not enabled (or does not know the instrument) the composite provider
// below falls back to Twelve Data, so nothing that worked before stops working.
import type { OHLCVBar, Timeframe } from "at24-quant-engine";
import type { HistoricalBarsRequest, HistoricalBarsResult, HistoricalDataProvider } from "./types";
import { validateBars } from "./validate-bars";
import { ExnessApiError, getSharedExnessClient, type ExnessApiClient } from "@/lib/market-data/exness-api";
import { mappingsForProvider } from "@/lib/market-data/instrument-catalog";
import { twelveDataHistoricalDataProvider } from "./twelve-data-provider";

/** Engine timeframe -> the interval token the Exness client takes. */
const INTERVAL: Readonly<Partial<Record<Timeframe, string>>> = { M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H4: "4h", D1: "1d" };
const BARS_PER_DAY: Readonly<Partial<Record<Timeframe, number>>> = { M1: 1440, M5: 288, M15: 96, M30: 48, H1: 24, H4: 6, D1: 1 };
const ASSET_CLASS: Readonly<Record<string, "metal" | "forex" | "crypto">> = { XAUUSD: "metal", XAGUSD: "metal", EURUSD: "forex", GBPUSD: "forex", USDJPY: "forex", BTCUSD: "crypto", ETHUSD: "crypto" };

/** getCandlesPaged stops after 40 pages of 1,000: the most bars one test can load. */
export const EXNESS_MAX_BARS = 40_000;
export const EXNESS_MAX_RANGE_DAYS = 730;

/** The longest window (days) the Exness provider serves for a timeframe: two years where the bars fit in the page budget, shorter for fast timeframes. */
export function exnessMaxRangeDaysFor(timeframe: Timeframe): number | undefined {
  const perDay = BARS_PER_DAY[timeframe];
  if (perDay === undefined) return undefined;
  return Math.min(EXNESS_MAX_RANGE_DAYS, Math.floor(EXNESS_MAX_BARS / perDay));
}

export function exnessHistoryEnabled(client: ExnessApiClient = getSharedExnessClient()): boolean {
  return client.isEnabled();
}

interface CacheEntry { at: number; result: HistoricalBarsResult }
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE = 8;

export class ExnessHistoricalDataProvider implements HistoricalDataProvider {
  readonly id = "exness-api";
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly client: ExnessApiClient = getSharedExnessClient(), private readonly now: () => number = () => Date.now()) {}

  supports(request: HistoricalBarsRequest): boolean {
    return this.client.isEnabled() && INTERVAL[request.timeframe] !== undefined && ASSET_CLASS[request.symbol.toUpperCase()] !== undefined;
  }

  async getBars(request: HistoricalBarsRequest): Promise<HistoricalBarsResult> {
    const interval = INTERVAL[request.timeframe];
    const perDay = BARS_PER_DAY[request.timeframe];
    const symbol = request.symbol.toUpperCase();
    const assetClass = ASSET_CLASS[symbol];
    if (!interval || !perDay || !assetClass) throw new Error(`ExnessHistoricalDataProvider: '${request.symbol}'/'${request.timeframe}' is not supported.`);

    const startMs = Date.parse(request.startTime);
    const endMs = Date.parse(request.endTime);
    const key = `${symbol}|${request.timeframe}|${request.startTime.slice(0, 10)}|${request.endTime.slice(0, 10)}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.result;

    const mt5Symbol = mappingsForProvider("mt5").find((m) => m.instrument.id === symbol)?.mapping.providerSymbol ?? symbol;
    const rangeDays = Math.max(1, (endMs - startMs) / 86_400_000);
    const total = Math.min(EXNESS_MAX_BARS, Math.ceil(rangeDays * perDay) + 50);
    // pages go backwards from the end of the window; weekend gaps mean fewer bars than days * barsPerDay, so the start time is the real limit
    const rows = await this.client.getCandlesPaged(mt5Symbol, interval, total, new Date(endMs).toISOString().replace(/\.\d{3}Z$/, "Z"));

    const instrument = { symbol: request.symbol, assetClass };
    const raw: OHLCVBar[] = [];
    for (const r of rows) {
      const ts = Date.parse(r.datetime);
      if (!Number.isFinite(ts) || ts < startMs || ts > endMs) continue;
      raw.push({ timestamp: ts, instrument, timeframe: request.timeframe, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? 0 });
    }
    raw.sort((a, b) => a.timestamp - b.timestamp);
    const { validBars, rejected } = validateBars(raw, { instrument, timeframe: request.timeframe });
    const result: HistoricalBarsResult = { bars: validBars, rejected, source: `exness-api (${mt5Symbol}/${interval}, ${validBars.length} bars)` };
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: this.now(), result });
    return result;
  }
}

/** Exness first (long windows, fresh data); Twelve Data when the Exness API is off, does not know the instrument, or fails. */
export class CompositeHistoricalDataProvider implements HistoricalDataProvider {
  readonly id = "exness-then-twelve-data";
  constructor(private readonly exness: ExnessHistoricalDataProvider = new ExnessHistoricalDataProvider(), private readonly fallback: HistoricalDataProvider = twelveDataHistoricalDataProvider) {}

  async getBars(request: HistoricalBarsRequest): Promise<HistoricalBarsResult> {
    if (this.exness.supports(request)) {
      try {
        const res = await this.exness.getBars(request);
        if (res.bars.length > 0) return res;
      } catch (error) {
        if (!(error instanceof ExnessApiError) && !(error instanceof Error)) throw error;
        // any Exness problem: fall through to Twelve Data (its shorter window is enforced by the caller's range check only when Exness is off)
      }
    }
    // Twelve Data serves one request of about 14 days of M5 (4,032 bars): a longer window must not be answered with a silently shortened series
    const perDay = BARS_PER_DAY[request.timeframe] ?? 1;
    const days = (Date.parse(request.endTime) - Date.parse(request.startTime)) / 86_400_000;
    if (days > Math.floor(4032 / perDay)) throw new Error("Historical bars for this long window are not available right now (the Exness data feed did not answer). Try a shorter window.");
    return this.fallback.getBars(request);
  }
}

export const defaultHistoricalDataProvider = new CompositeHistoricalDataProvider();
