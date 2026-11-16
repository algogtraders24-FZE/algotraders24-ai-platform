// services/swing-lab/swing-lab.service.ts
// Reads weekly, daily and 4-hour candles (read-only, Exness symbols) and builds the swing map rows.
//
// Sources, as for the mt5 market-data provider: the Exness Trading API (when EXNESS_API_ENABLED=1) and the AT24 VPS bridge as the backup.
// The Exness API rate limits bursts (a first version sent 12 requests at once: 10 got HTTP 429, then the client paused itself for a minute and
// every market fell back to the bridge; at 2 at a time it still hit 429 after a few calls), and the limit is not published. So:
//  - Exness requests run one at a time with a gap between them, and each refresh may send at most EXNESS_BUDGET of them; the rest go to the bridge;
//  - candles that came from Exness are kept for as long as they stay useful (weekly 6 hours, daily 1 hour, 4-hour 4 minutes), so over a few refreshes
//    the slow-moving timeframes move to Exness for good and a refresh needs only about one request per market;
//  - candles that came from the bridge are kept 4 minutes only, so Exness gets another chance at the next refresh;
//  - if the bridge itself fails for a request, Exness is tried even when the refresh budget is used up, so one source can carry the page alone.
// The whole overview is kept for 5 minutes.
import "server-only";
import { loadExnessApiEnv, loadMt5BridgeEnv, type Mt5BridgeEnv } from "@/lib/market-data/env";
import { ExnessApiClient, ExnessApiError } from "@/lib/market-data/exness-api";
import { SWING_INSTRUMENTS, type SwingMapOverview, type SwingMapOverviewRow } from "@/types/swing-lab";
import { computeSwingMapFromBars, parseBridgeCandles, type Bar, type BridgeCandle } from "./compute";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MS = 5 * 60_000;
const CONCURRENCY = 4;
const EXNESS_GAP_MS = 300;
const EXNESS_BUDGET = 14;
/** Closed bars wanted per timeframe; the source returns one more (the forming candle) which is dropped by the clock rule. */
const WEEKLY_COUNT = 62;
const DAILY_COUNT = 262;
const H4_COUNT = 122;

const INTERVAL_MS: Record<string, number> = { "4h": 4 * 3_600_000, "1d": 86_400_000, "1w": 7 * 86_400_000 };
const EXNESS_TTL_MS: Record<string, number> = { "1w": 6 * 3_600_000, "1d": 3_600_000, "4h": 4 * 60_000 };
const BRIDGE_TTL_MS = 4 * 60_000;
const exness = new ExnessApiClient({ env: loadExnessApiEnv() });

export type CandleSource = "exness" | "bridge";
type Candles = { candles: BridgeCandle[]; source: CandleSource };

/** Why the Exness API did not serve a candle request (kind of error only, never a secret), for the diagnostics field of the overview. */
let exnessErrors: Record<string, number> = {};
let exnessSample = "";
let exnessBudget = EXNESS_BUDGET;

class NotConnectedError extends Error {}
class TooShortError extends Error {}

// ---- Exness requests: one at a time, with a gap ----
let exnessChain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function pacedExness<T>(fn: () => Promise<T>): Promise<T> {
  const run = exnessChain.then(async () => {
    try {
      return await fn();
    } finally {
      await sleep(EXNESS_GAP_MS);
    }
  });
  exnessChain = run.catch(() => undefined);
  return run;
}

function noteExnessError(symbol: string, interval: string, error: unknown): void {
  const kind = error instanceof ExnessApiError ? error.kind : "other";
  exnessErrors[kind] = (exnessErrors[kind] ?? 0) + 1;
  if (!exnessSample) exnessSample = `${symbol} ${interval}: ${error instanceof ExnessApiError ? error.message : error instanceof Error ? error.name : "error"}`;
}

async function fromExness(symbol: string, interval: string, count: number): Promise<Candles | null> {
  try {
    return { candles: await pacedExness(() => exness.getCandles(symbol, interval, count)), source: "exness" };
  } catch (error) {
    noteExnessError(symbol, interval, error);
    return null; // any Exness API problem: the caller falls back to the VPS bridge
  }
}

async function fromBridge(env: Mt5BridgeEnv, symbol: string, interval: string, count: number): Promise<Candles> {
  const url = `${env.bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&count=${count}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.secret}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (res.status === 400 || res.status === 404) throw new NotConnectedError(symbol);
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const body = (await res.json()) as { candles?: BridgeCandle[] };
  return { candles: Array.isArray(body.candles) ? body.candles : [], source: "bridge" };
}

async function fetchUncached(env: Mt5BridgeEnv | null, symbol: string, interval: string, count: number, useBudget: boolean): Promise<Candles> {
  let exnessTried = false;
  if (exness.isEnabled() && (!useBudget || exnessBudget > 0)) {
    if (useBudget) exnessBudget -= 1;
    exnessTried = true;
    const got = await fromExness(symbol, interval, count);
    if (got) return got;
  }
  if (env) {
    try {
      return await fromBridge(env, symbol, interval, count);
    } catch (error) {
      if (error instanceof NotConnectedError) throw error;
      if (!exness.isEnabled() || exnessTried) throw error;
      // the bridge failed and the refresh budget kept Exness out: let Exness carry this request
      const got = await fromExness(symbol, interval, count);
      if (got) return got;
      throw error;
    }
  }
  throw new Error("no data source configured");
}

const candleCache = new Map<string, { at: number; value: Candles }>();

async function cachedCandles(env: Mt5BridgeEnv | null, symbol: string, interval: string, count: number, useBudget = true): Promise<Candles> {
  const key = `${symbol}|${interval}|${count}`;
  const hit = candleCache.get(key);
  const now = Date.now();
  if (hit) {
    const ttl = hit.value.source === "exness" ? (EXNESS_TTL_MS[interval] ?? 60_000) : BRIDGE_TTL_MS;
    if (now - hit.at < ttl) return hit.value;
  }
  const value = await fetchUncached(env, symbol, interval, count, useBudget);
  candleCache.set(key, { at: now, value });
  return value;
}

/** Closed bars of one market (used by the scoreboard tracker): Exness API first, bridge second. Throws when neither source works. */
export async function fetchClosedBars(symbol: string, interval: "4h" | "1d" | "1w", count: number, nowMs: number): Promise<Bar[]> {
  const { candles } = await cachedCandles(loadMt5BridgeEnv(), symbol, interval, count, false);
  return parseBridgeCandles(candles, { nowMs, intervalMs: INTERVAL_MS[interval] });
}

async function oneRow(env: Mt5BridgeEnv | null, symbol: string, nowMs: number, tally: Record<CandleSource, number>): Promise<SwingMapOverviewRow> {
  try {
    const [w, d, h] = await Promise.all([cachedCandles(env, symbol, "1w", WEEKLY_COUNT), cachedCandles(env, symbol, "1d", DAILY_COUNT), cachedCandles(env, symbol, "4h", H4_COUNT)]);
    for (const x of [w, d, h]) tally[x.source] += 1;
    const closed = (c: Candles, interval: string) => parseBridgeCandles(c.candles, { nowMs, intervalMs: INTERVAL_MS[interval] });
    const row = computeSwingMapFromBars(symbol, closed(d, "1d"), closed(h, "4h"), closed(w, "1w"));
    if (!row) throw new TooShortError(symbol);
    return { symbol, status: "ok", data: row };
  } catch (error) {
    if (error instanceof NotConnectedError) return { symbol, status: "unavailable", reason: "not_connected", message: "Not connected yet" };
    if (error instanceof TooShortError) return { symbol, status: "unavailable", reason: "error", message: "Not enough daily history" };
    return { symbol, status: "unavailable", reason: "error", message: "Temporarily unavailable" };
  }
}

let cached: { at: number; value: SwingMapOverview } | null = null;

export async function getSwingMapOverview(): Promise<SwingMapOverview> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const env = loadMt5BridgeEnv();
  if (!env && !exness.isEnabled()) {
    return { rows: SWING_INSTRUMENTS.map((i) => ({ symbol: i.symbol, status: "unavailable", reason: "error", message: "Market data is not configured" })), asOf: now, source: "none" };
  }
  const tally: Record<CandleSource, number> = { exness: 0, bridge: 0 };
  exnessErrors = {};
  exnessSample = "";
  exnessBudget = EXNESS_BUDGET;
  const rows: SwingMapOverviewRow[] = new Array(SWING_INSTRUMENTS.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < SWING_INSTRUMENTS.length) {
        const i = next++;
        rows[i] = await oneRow(env, SWING_INSTRUMENTS[i].symbol, now, tally);
      }
    }),
  );
  const source = tally.exness > 0 && tally.bridge > 0 ? "mixed" : tally.exness > 0 ? "exness" : "bridge";
  const value: SwingMapOverview = { rows, asOf: now, source, exnessDiag: { enabled: exness.isEnabled(), errors: exnessErrors, sample: exnessSample || undefined } };
  // Keep a result only when most markets loaded, so a short outage is not remembered for 5 minutes.
  if (rows.filter((r) => r.status === "ok").length >= rows.length / 2) cached = { at: now, value };
  return value;
}
