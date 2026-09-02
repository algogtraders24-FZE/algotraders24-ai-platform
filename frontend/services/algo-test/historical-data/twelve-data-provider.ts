// services/algo-test/historical-data/twelve-data-provider.ts
// P3.2A.1 Gate 2/3/5 - the PRODUCTION historical-data source for the Algo
// Test pipeline. Chosen over market-db-provider.ts (which requires a local,
// gitignored SQLite file unreachable in any deployed environment - see
// docs/P3.2A.1-HISTORICAL-DATA-DECISION.md) because Twelve Data is:
//   - already the platform's live, deployed, PRIMARY market-data provider
//     (lib/market-data/providers/twelve-data.provider.ts), already
//     authenticated (TWELVEDATA_API_KEY already configured in production),
//   - a pure HTTPS call with zero filesystem dependency, so it behaves
//     identically in local dev, CI, and on Vercel,
//   - verified (this sprint) to support a real start_date/end_date range
//     query on /time_series, which its existing adapter does not use today
//     (that adapter only ever requests the latest N bars) - this is a NEW
//     adapter, not a modification of the existing one, so nothing about
//     the existing live chart/paper-trading data path changes.
//
// Symbol mapping is a deliberate, manually-kept-in-sync MIRROR of
// lib/market-data/providers/twelve-data.provider.ts's own internal
// SYMBOL_MAP - matching this codebase's own established convention
// (lib/market-data/instrument-catalog.ts's header comment: "twelve-data /
// alpha-vantage adapters... never rewritten to read from this catalog").
// Not a new source of truth, not a second copy of provider logic - only
// the one string each symbol needs.
import type { OHLCVBar, Timeframe } from "at24-quant-engine";
import { loadTwelveDataEnv } from "@/lib/market-data/env";
import type { HistoricalBarsRequest, HistoricalBarsResult, HistoricalDataProvider } from "./types";
import { validateBars } from "./validate-bars";

const TIMESERIES_URL = "https://api.twelvedata.com/time_series";

/** Mirrors twelve-data.provider.ts's SYMBOL_MAP[...].td - see file header. */
const CANONICAL_TO_TWELVE_DATA_SYMBOL: Readonly<Record<string, string>> = {
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  BTCUSD: "BTC/USD",
  ETHUSD: "ETH/USD",
};

const ENGINE_TIMEFRAME_TO_TWELVE_DATA_INTERVAL: Readonly<Partial<Record<Timeframe, string>>> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
  H4: "4h",
  D1: "1day",
};

const ASSET_CLASS_MAP: Readonly<Record<string, "metal" | "forex" | "crypto">> = {
  XAUUSD: "metal",
  XAGUSD: "metal",
  EURUSD: "forex",
  GBPUSD: "forex",
  USDJPY: "forex",
  BTCUSD: "crypto",
  ETHUSD: "crypto",
};

interface TwelveDataTimeSeriesRow {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface TwelveDataTimeSeriesResponse {
  values?: TwelveDataTimeSeriesRow[];
  status?: string;
  code?: number;
  message?: string;
}

function toFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Twelve Data's `datetime` here is UTC because every request explicitly passes `&timezone=UTC` - never assumed. */
function parseUtcDatetime(datetime: string): number {
  return Date.parse(`${datetime.replace(" ", "T")}Z`);
}

export class TwelveDataHistoricalDataProvider implements HistoricalDataProvider {
  readonly id = "twelve-data";

  async getBars(request: HistoricalBarsRequest): Promise<HistoricalBarsResult> {
    const env = loadTwelveDataEnv();
    if (!env) {
      throw new Error("TwelveDataHistoricalDataProvider: TWELVEDATA_API_KEY is not configured.");
    }

    const tdSymbol = CANONICAL_TO_TWELVE_DATA_SYMBOL[request.symbol.toUpperCase()];
    const interval = ENGINE_TIMEFRAME_TO_TWELVE_DATA_INTERVAL[request.timeframe];
    const assetClass = ASSET_CLASS_MAP[request.symbol.toUpperCase()];
    if (!tdSymbol || !interval || !assetClass) {
      throw new Error(
        `TwelveDataHistoricalDataProvider: '${request.symbol}'/'${request.timeframe}' is not in the verified symbol/timeframe map - refusing to guess a mapping rather than silently return the wrong instrument's data.`,
      );
    }

    // Twelve Data's start_date/end_date accept a date or datetime; the
    // whole-day forms keep the request simple and match the exact
    // fixed-range convention this sprint's Golden Run already uses.
    const startDate = request.startTime.slice(0, 10);
    const endDate = request.endTime.slice(0, 10);

    const url = `${TIMESERIES_URL}?symbol=${encodeURIComponent(tdSymbol)}&interval=${encodeURIComponent(interval)}&start_date=${startDate}&end_date=${endDate}&timezone=UTC&apikey=${encodeURIComponent(env.apiKey)}`;

    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      // Never attach the raw transport error or echo the URL (it carries the key).
      throw new Error("TwelveDataHistoricalDataProvider: failed to reach Twelve Data.");
    }
    // Twelve Data sends a real, useful JSON error body (status/code/message)
    // alongside a non-200 HTTP status (e.g. 400 for "no data available for
    // this date range", confirmed live this sprint) - read the body FIRST
    // and prefer its real message over a generic "HTTP {status}", the same
    // "never lose the real reason" discipline the rest of this codebase's
    // provider error handling already follows.
    let body: TwelveDataTimeSeriesResponse | undefined;
    try {
      body = (await res.json()) as TwelveDataTimeSeriesResponse;
    } catch {
      if (!res.ok) throw new Error(`TwelveDataHistoricalDataProvider: Twelve Data returned HTTP ${res.status}.`);
      throw new Error("TwelveDataHistoricalDataProvider: Twelve Data response was not valid JSON.");
    }
    if (body.status === "error" || typeof body.code === "number") {
      throw new Error(`TwelveDataHistoricalDataProvider: Twelve Data error (${body.code ?? "unknown"}): ${body.message ?? "unknown error"}`);
    }
    if (!res.ok) {
      throw new Error(`TwelveDataHistoricalDataProvider: Twelve Data returned HTTP ${res.status}.`);
    }

    const rows = body.values ?? [];
    // Twelve Data returns newest-first; parse and reverse to oldest-first,
    // matching at24-quant-engine's own ordering requirement. A row missing
    // any OHLC value is dropped rather than zero-filled - never fabricated.
    const instrument = { symbol: request.symbol, assetClass };
    const rawBars: OHLCVBar[] = [];
    for (const row of rows) {
      const open = toFiniteNumber(row.open);
      const high = toFiniteNumber(row.high);
      const low = toFiniteNumber(row.low);
      const close = toFiniteNumber(row.close);
      if (open === undefined || high === undefined || low === undefined || close === undefined || !row.datetime) continue;
      rawBars.push({
        timestamp: parseUtcDatetime(row.datetime),
        instrument,
        timeframe: request.timeframe,
        open,
        high,
        low,
        close,
        // Twelve Data does not report real traded volume for spot FX/metals
        // (confirmed empty for XAU/USD this sprint) - 0, never fabricated.
        volume: toFiniteNumber(row.volume) ?? 0,
      });
    }
    rawBars.reverse();

    const { validBars, rejected } = validateBars(rawBars, { instrument, timeframe: request.timeframe });

    return {
      bars: validBars,
      rejected,
      source: `twelve-data (${tdSymbol}/${interval})`,
    };
  }
}

export const twelveDataHistoricalDataProvider = new TwelveDataHistoricalDataProvider();
