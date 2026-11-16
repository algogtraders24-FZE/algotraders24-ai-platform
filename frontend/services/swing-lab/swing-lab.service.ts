// services/swing-lab/swing-lab.service.ts
// Reads weekly, daily and 4-hour candles from the AT24 MT5 data bridge (read-only, Exness symbols) and builds the swing map rows.
// The bridge is one small terminal on a VPS, so the requests are limited to a few at a time and the whole result is kept for 5 minutes.
import "server-only";
import { loadMt5BridgeEnv, type Mt5BridgeEnv } from "@/lib/market-data/env";
import { SWING_INSTRUMENTS, type SwingMapOverview, type SwingMapOverviewRow } from "@/types/swing-lab";
import { computeSwingMapFromBars, parseBridgeCandles, type BridgeCandle } from "./compute";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MS = 5 * 60_000;
const CONCURRENCY = 4;
/** Closed bars wanted per timeframe; the bridge returns one more (the forming candle) which is dropped. */
const WEEKLY_COUNT = 62;
const DAILY_COUNT = 262;
const H4_COUNT = 122;

class NotConnectedError extends Error {}
class TooShortError extends Error {}

async function bridgeCandles(env: Mt5BridgeEnv, symbol: string, interval: string, count: number): Promise<BridgeCandle[]> {
  const url = `${env.bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&count=${count}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.secret}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (res.status === 400 || res.status === 404) throw new NotConnectedError(symbol);
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const body = (await res.json()) as { candles?: BridgeCandle[] };
  return Array.isArray(body.candles) ? body.candles : [];
}

/** Candles of one market from the bridge (used by the scoreboard tracker). Throws when the bridge is not configured or fails. */
export async function fetchBridgeCandles(symbol: string, interval: string, count: number): Promise<BridgeCandle[]> {
  const env = loadMt5BridgeEnv();
  if (!env) throw new Error("bridge not configured");
  return bridgeCandles(env, symbol, interval, count);
}

async function oneRow(env: Mt5BridgeEnv, symbol: string): Promise<SwingMapOverviewRow> {
  try {
    const [w, d, h] = await Promise.all([bridgeCandles(env, symbol, "1w", WEEKLY_COUNT), bridgeCandles(env, symbol, "1d", DAILY_COUNT), bridgeCandles(env, symbol, "4h", H4_COUNT)]);
    const row = computeSwingMapFromBars(symbol, parseBridgeCandles(d), parseBridgeCandles(h), parseBridgeCandles(w));
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
  if (!env) {
    return { rows: SWING_INSTRUMENTS.map((i) => ({ symbol: i.symbol, status: "unavailable", reason: "error", message: "Market data bridge is not configured" })), asOf: now };
  }
  const rows: SwingMapOverviewRow[] = new Array(SWING_INSTRUMENTS.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < SWING_INSTRUMENTS.length) {
        const i = next++;
        rows[i] = await oneRow(env, SWING_INSTRUMENTS[i].symbol);
      }
    }),
  );
  const value: SwingMapOverview = { rows, asOf: now };
  // Keep a result only when most markets loaded, so a short bridge outage is not remembered for 5 minutes.
  if (rows.filter((r) => r.status === "ok").length >= rows.length / 2) cached = { at: now, value };
  return value;
}
