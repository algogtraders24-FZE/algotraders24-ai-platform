// services/market-board/market-board.service.ts
// Reads candles (read-only, Exness symbols) and builds the Market Board data: a chart with Zone Pro and Divergence Pro overlays, and a
// heatmap and correlation table. Source order, as for the mt5 market-data provider: the Exness Trading API first (when EXNESS_API_ENABLED=1),
// the AT24 VPS bridge when the API is off or fails for any reason. Results are cached in memory (chart 10 s, overview 5 min) so many viewers
// never multiply the number of upstream requests.
import "server-only";
import { loadMt5BridgeEnv, type Mt5BridgeEnv } from "@/lib/market-data/env";
import { getSharedExnessClient } from "@/lib/market-data/exness-api";
import {
  BOARD_INSTRUMENTS, BOARD_PAIRS, type BoardChartDto, type BoardCorrelationRow, type BoardOverviewDto, type BoardOverviewRow, type BoardTimeframe, type CandleSource,
} from "@/types/market-board";
import { computeCorrelation, computeDivergenceBoard, computeOverviewRow, computeZoneBoard, shiftStatus, type Bar } from "./indicators";

const FETCH_TIMEOUT_MS = 10_000;
const CHART_CACHE_MS = 10_000;
const OVERVIEW_CACHE_MS = 5 * 60_000;
const CONCURRENCY = 2;
const SHIFT_LEVEL = 0.4;
/** Candles kept per chart (the scorecards are computed on all of them, the chart draws the last DISPLAY_BARS). 8000 matches the MT5 builds' default history. */
const HISTORY_TARGET: Record<BoardTimeframe, number> = { "15m": 8000, "1h": 8000, "4h": 6000, "1d": 1000 };
/** The newest page re-read on every refresh; older candles never change, so they are kept. */
const REFRESH_BARS = 1000;
const HISTORY_ENTRIES_MAX = 16;
const DISPLAY_BARS = 160;
const DAILY_BARS = 1000;

const INTERVAL_MS: Record<BoardTimeframe, number> = { "15m": 15 * 60_000, "1h": 3_600_000, "4h": 4 * 3_600_000, "1d": 86_400_000 };
const exness = getSharedExnessClient();

interface RawCandle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

async function fetchRaw(env: Mt5BridgeEnv | null, symbol: string, interval: BoardTimeframe, count: number): Promise<{ candles: RawCandle[]; source: CandleSource }> {
  if (exness.isEnabled()) {
    try {
      return { candles: await exness.getCandles(symbol, interval, count), source: "exness" };
    } catch {
      // any Exness API problem: fall back to the VPS bridge below
    }
  }
  if (!env) throw new Error("no data source configured");
  const url = `${env.bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&count=${count}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.secret}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const body = (await res.json()) as { candles?: RawCandle[] };
  return { candles: Array.isArray(body.candles) ? body.candles : [], source: "bridge" };
}

/** Splits candles into closed bars and the still-forming one (a bar is closed once its open time plus the interval has passed). */
function splitBars(candles: RawCandle[], interval: BoardTimeframe, nowMs: number): { closed: Bar[]; forming: Bar | null } {
  const bars: Bar[] = candles
    .filter((c) => typeof c.datetime === "string" && [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v)))
    .map((c) => ({ time: c.datetime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const last = bars[bars.length - 1];
  if (last && Date.parse(last.time) + INTERVAL_MS[interval] > nowMs) return { closed: bars.slice(0, -1), forming: last };
  return { closed: bars, forming: null };
}

interface HistoryEntry {
  candles: RawCandle[];
  source: CandleSource;
  at: number;
}
const historyCache = new Map<string, HistoryEntry>();
const historyLoading = new Map<string, Promise<HistoryEntry>>();

function mergeCandles(oldC: RawCandle[], fresh: RawCandle[], keep: number): RawCandle[] {
  const byTime = new Map<string, RawCandle>();
  for (const c of oldC) byTime.set(c.datetime, c);
  for (const c of fresh) byTime.set(c.datetime, c);
  return [...byTime.values()].sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime)).slice(-keep);
}

/** Deep history for one chart: the first load pages back through the Exness API (older candles are then cached), every later refresh reads only the newest page. */
async function getHistory(env: Mt5BridgeEnv | null, symbol: string, interval: BoardTimeframe): Promise<HistoryEntry> {
  const key = `${symbol}|${interval}`;
  const target = HISTORY_TARGET[interval];
  const cached = historyCache.get(key);
  if (cached) {
    const fresh = await fetchRaw(env, symbol, interval, REFRESH_BARS);
    const entry: HistoryEntry = { candles: mergeCandles(cached.candles, fresh.candles, target), source: fresh.source, at: Date.now() };
    historyCache.set(key, entry);
    return entry;
  }
  const loading = historyLoading.get(key);
  if (loading) return loading;
  const job = (async () => {
    let candles: RawCandle[] | null = null;
    let source: CandleSource = "exness";
    if (exness.isEnabled()) {
      try {
        candles = await exness.getCandlesPaged(symbol, interval, target);
      } catch {
        candles = null; // any Exness API problem: fall back to the VPS bridge below
      }
    }
    if (!candles) {
      const raw = await fetchRaw(env, symbol, interval, Math.min(target, 5000));
      candles = raw.candles;
      source = raw.source;
    }
    const entry: HistoryEntry = { candles, source, at: Date.now() };
    if (historyCache.size >= HISTORY_ENTRIES_MAX) {
      const oldest = [...historyCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) historyCache.delete(oldest[0]);
    }
    historyCache.set(key, entry);
    return entry;
  })().finally(() => historyLoading.delete(key));
  historyLoading.set(key, job);
  return job;
}

const chartCache = new Map<string, { at: number; value: BoardChartDto }>();

export async function getBoardChart(symbol: string, interval: BoardTimeframe): Promise<BoardChartDto> {
  const now = Date.now();
  const key = `${symbol}|${interval}`;
  const hit = chartCache.get(key);
  if (hit && now - hit.at < CHART_CACHE_MS) return hit.value;
  const env = loadMt5BridgeEnv();
  if (!env && !exness.isEnabled()) throw new Error("Market data is not configured");

  const { candles, source } = await getHistory(env, symbol, interval);
  const { closed, forming } = splitBars(candles, interval, now);
  if (closed.length < 200) throw new Error("Not enough history");

  let cost = 0;
  if (exness.isEnabled()) {
    try {
      const q = await exness.getQuote(symbol);
      cost = Math.max(0, q.ask - q.bid);
    } catch {
      cost = 0;
    }
  }

  const zones = computeZoneBoard(closed, cost);
  const divergences = computeDivergenceBoard(closed, cost);
  const toDto = (b: Bar) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
  const value: BoardChartDto = {
    symbol,
    interval,
    candles: closed.slice(-DISPLAY_BARS).map(toDto),
    forming: forming ? toDto(forming) : null,
    zones,
    divergences,
    costUsed: cost,
    barsAnalysed: closed.length,
    source,
    asOf: now,
  };
  chartCache.set(key, { at: now, value });
  return value;
}

let overviewCache: { at: number; value: BoardOverviewDto } | null = null;

export async function getBoardOverview(): Promise<BoardOverviewDto> {
  const now = Date.now();
  if (overviewCache && now - overviewCache.at < OVERVIEW_CACHE_MS) return overviewCache.value;
  const env = loadMt5BridgeEnv();
  if (!env && !exness.isEnabled()) {
    return { rows: BOARD_INSTRUMENTS.map((i) => ({ symbol: i.symbol, status: "unavailable", message: "Market data is not configured" })), pairs: [], shiftLevel: SHIFT_LEVEL, asOf: now, source: "none" };
  }

  const daily = new Map<string, Bar[]>();
  const sources = new Set<CandleSource>();
  const symbols = BOARD_INSTRUMENTS.map((i) => i.symbol);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < symbols.length) {
        const s = symbols[next++];
        try {
          const { candles, source } = await fetchRaw(env, s, "1d", DAILY_BARS);
          const { closed } = splitBars(candles, "1d", now);
          daily.set(s, closed);
          sources.add(source);
        } catch {
          // this market stays "unavailable"; the others still load
        }
      }
    }),
  );

  const rows: BoardOverviewRow[] = symbols.map((symbol) => {
    const bars = daily.get(symbol);
    if (!bars) return { symbol, status: "unavailable", message: "Temporarily unavailable" };
    const data = computeOverviewRow(bars);
    return data ? { symbol, status: "ok", data } : { symbol, status: "unavailable", message: "Not enough daily history" };
  });

  const pairs: BoardCorrelationRow[] = BOARD_PAIRS.map(([a, b]) => {
    const A = daily.get(a);
    const B = daily.get(b);
    const data = A && B ? computeCorrelation(A, B) : null;
    return data ? { a, b, status: "ok", data, shift: shiftStatus(data, SHIFT_LEVEL) } : { a, b, status: "unavailable" };
  });

  const source = sources.size === 0 ? "none" : sources.size === 2 ? "mixed" : [...sources][0];
  const value: BoardOverviewDto = { rows, pairs, shiftLevel: SHIFT_LEVEL, asOf: now, source };
  if (sources.size > 0) overviewCache = { at: now, value };
  return value;
}
