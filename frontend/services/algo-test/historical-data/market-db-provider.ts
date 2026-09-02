// services/algo-test/historical-data/market-db-provider.ts
// P3.2A Blocker 2 - a HistoricalDataProvider implementation reading real
// historical XAUUSD (and other) OHLCV bars directly from the repo's own
// quant_engine/market.db SQLite file (real Exness tick-derived candles,
// 2024-01-01 through 2026-05-31 for XAUUSD_EXNESS - see
// docs/P3.1-DATA-COMPATIBILITY.md SS5 and P3.2A-HISTORICAL-DATA-CONTRACT.md).
//
// Deliberately isolated: this file opens its OWN read-only SQLite
// connection and runs its OWN query against the raw `candles` table. It
// imports NOTHING from services/quant-lite/** or quant-engine/spec_engine/**
// - no job store, no execution adapter, no coverage-policy code. This is
// the "isolated provider/adapter" the P3.2A brief explicitly allows,
// deliberately NOT "Pro Engine -> Quant Lite database internals" coupling
// (that would mean importing quant-lite's own TypeScript service code,
// which this does not do). market.db is treated purely as a stable,
// real data file, exactly the same way a CSV or a broker API response
// would be.
//
// Read-only + WAL: SQLite's WAL mode allows a read-only connection to
// safely coexist with a concurrent writer (verified live against this
// exact file, which had an active -wal/-shm pair at audit time from a
// concurrent Quant Lite session) - this provider never writes.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { OHLCVBar } from "at24-quant-engine";
import type { HistoricalBarsRequest, HistoricalBarsResult, HistoricalDataProvider } from "./types";
import { toAssetClass, toMarketDbSymbol, toMarketDbTimeframe } from "./symbol-timeframe-map";
import { validateBars } from "./validate-bars";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
/** services/algo-test/historical-data -> services/algo-test -> services -> frontend -> repo root. */
const REPO_ROOT = path.resolve(THIS_DIR, "..", "..", "..", "..");

/**
 * Resolves the market.db path. Honors AT24_MARKET_DB_PATH if set (e.g. a
 * future deployment that stages the file elsewhere); otherwise assumes
 * the monorepo-local path. This provider requires filesystem access to
 * the sibling quant_engine/ directory - it works in local dev and any
 * build/CI context that checks out the full monorepo, but NOT in a
 * deployed environment that only bundles frontend/ (e.g. Vercel) - that
 * is a real, disclosed limitation of this foundation sprint, not solved
 * here (see P3.2A-HISTORICAL-DATA-CONTRACT.md "Known limitation").
 */
export function resolveMarketDbPath(): string {
  return process.env.AT24_MARKET_DB_PATH ?? path.join(REPO_ROOT, "quant_engine", "market.db");
}

export class MarketDbHistoricalDataProvider implements HistoricalDataProvider {
  readonly id = "market-db";

  async getBars(request: HistoricalBarsRequest): Promise<HistoricalBarsResult> {
    const dbPath = resolveMarketDbPath();
    if (!existsSync(dbPath)) {
      throw new Error(`MarketDbHistoricalDataProvider: market.db not found at '${dbPath}' - this provider requires local monorepo filesystem access (see resolveMarketDbPath doc comment).`);
    }

    const marketDbSymbol = toMarketDbSymbol(request.symbol);
    const marketDbTimeframe = toMarketDbTimeframe(request.timeframe);
    const assetClass = toAssetClass(request.symbol);
    if (!marketDbSymbol || !marketDbTimeframe || !assetClass) {
      throw new Error(
        `MarketDbHistoricalDataProvider: '${request.symbol}'/'${request.timeframe}' is not in the verified symbol/timeframe map (symbol-timeframe-map.ts) - refusing to guess a mapping rather than silently return the wrong instrument's data.`,
      );
    }

    const startTs = new Date(request.startTime).toISOString().replace(".000Z", "+00:00");
    const endTs = new Date(request.endTime).toISOString().replace(".000Z", "+00:00");

    const db = new DatabaseSync(dbPath, { readOnly: true });
    let rows: MarketDbCandleRow[];
    try {
      rows = db
        .prepare(
          "SELECT symbol, timeframe, ts, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC",
        )
        .all(marketDbSymbol, marketDbTimeframe, startTs, endTs) as MarketDbCandleRow[];
    } finally {
      db.close();
    }

    const instrument = { symbol: request.symbol, assetClass };
    const rawBars: OHLCVBar[] = rows.map((row) => ({
      timestamp: Date.parse(row.ts),
      instrument,
      timeframe: request.timeframe,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? 0,
    }));

    const { validBars, rejected } = validateBars(rawBars, { instrument, timeframe: request.timeframe });

    return {
      bars: validBars,
      rejected,
      source: `market.db (${marketDbSymbol}/${marketDbTimeframe})`,
    };
  }
}

interface MarketDbCandleRow {
  symbol: string;
  timeframe: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export const marketDbHistoricalDataProvider = new MarketDbHistoricalDataProvider();
