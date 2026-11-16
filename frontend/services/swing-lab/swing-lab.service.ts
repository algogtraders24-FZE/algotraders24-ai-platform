// services/swing-lab/swing-lab.service.ts
// Reads weekly, daily and 4-hour candles (read-only, Exness symbols) and builds the swing map rows. Source order, as for the mt5 market-data
// provider: the Exness Trading API first (when EXNESS_API_ENABLED=1), the AT24 VPS bridge when the API is off or fails for any reason.
// The bridge is one small terminal on a VPS, so the requests are limited to a few at a time and the whole result is kept for 5 minutes.
import "server-only";
import { loadExnessApiEnv, loadMt5BridgeEnv, type Mt5BridgeEnv } from "@/lib/market-data/env";
import { ExnessApiClient, ExnessApiError } from "@/lib/market-data/exness-api";
import { SWING_INSTRUMENTS, type SwingMapOverview, type SwingMapOverviewRow } from "@/types/swing-lab";
import { computeSwingMapFromBars, parseBridgeCandles, type Bar, type BridgeCandle } from "./compute";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MS = 5 * 60_000;
const CONCURRENCY = 4;
/** Closed bars wanted per timeframe; the bridge returns one more (the forming candle) which is dropped. */
const WEEKLY_COUNT = 62;
const DAILY_COUNT = 262;
const H4_COUNT = 122;

const INTERVAL_MS: Record<string, number> = { "4h": 4 * 3_600_000, "1d": 86_400_000, "1w": 7 * 86_400_000 };
const exness = new ExnessApiClient({ env: loadExnessApiEnv() });

export type CandleSource = "exness" | "bridge";

/** Why the Exness API did not serve a candle request (kind of error only, never a secret), for the diagnostics field of the overview. */
let exnessErrors: Record<string, number> = {};
let exnessSample = "";

class NotConnectedError extends Error {}
class TooShortError extends Error {}

async function bridgeCandles(env: Mt5BridgeEnv | null, symbol: string, interval: string, count: number): Promise<{ candles: BridgeCandle[]; source: CandleSource }> {
  if (exness.isEnabled()) {
    try {
      return { candles: await exness.getCandles(symbol, interval, count), source: "exness" };
    } catch (error) {
      // any Exness API problem: fall back to the VPS bridge below; remember only the kind of error
      const kind = error instanceof ExnessApiError ? error.kind : "other";
      exnessErrors[kind] = (exnessErrors[kind] ?? 0) + 1;
      if (!exnessSample) exnessSample = `${symbol} ${interval}: ${error instanceof ExnessApiError ? error.message : error instanceof Error ? error.name : "error"}`;
    }
  }
  if (!env) throw new Error("no data source configured");
  const url = `${env.bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&count=${count}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.secret}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (res.status === 400 || res.status === 404) throw new NotConnectedError(symbol);
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const body = (await res.json()) as { candles?: BridgeCandle[] };
  return { candles: Array.isArray(body.candles) ? body.candles : [], source: "bridge" };
}

/** Closed bars of one market (used by the scoreboard tracker): Exness API first, bridge second. Throws when neither source works. */
export async function fetchClosedBars(symbol: string, interval: "4h" | "1d" | "1w", count: number, nowMs: number): Promise<Bar[]> {
  const { candles } = await bridgeCandles(loadMt5BridgeEnv(), symbol, interval, count);
  return parseBridgeCandles(candles, { nowMs, intervalMs: INTERVAL_MS[interval] });
}

async function oneRow(env: Mt5BridgeEnv | null, symbol: string, nowMs: number, tally: Record<CandleSource, number>): Promise<SwingMapOverviewRow> {
  try {
    const [w, d, h] = await Promise.all([bridgeCandles(env, symbol, "1w", WEEKLY_COUNT), bridgeCandles(env, symbol, "1d", DAILY_COUNT), bridgeCandles(env, symbol, "4h", H4_COUNT)]);
    for (const x of [w, d, h]) tally[x.source] += 1;
    const closed = (c: { candles: BridgeCandle[] }, interval: string) => parseBridgeCandles(c.candles, { nowMs, intervalMs: INTERVAL_MS[interval] });
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
  // Keep a result only when most markets loaded, so a short bridge outage is not remembered for 5 minutes.
  if (rows.filter((r) => r.status === "ok").length >= rows.length / 2) cached = { at: now, value };
  return value;
}
