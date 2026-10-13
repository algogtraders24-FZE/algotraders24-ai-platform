// services/smc/smc-service.ts
// Fetches the candles the SMC engine needs (chart timeframe + a higher timeframe)
// from the shared market-data service (Exness MT5 first) and runs the engine.
// Best-effort: no data, too few candles or any failure -> null (never an estimate).
// Results are cached in-process for 60 seconds per symbol.

import type { Candle } from "@/types/market-candle";
import { analyzeSmc, DEFAULT_SMC_PARAMS, type SmcAnalysis, type SmcCandle } from "./smc-engine";

export const SMC_LTF = "1h";
export const SMC_HTF = "4h";
const LTF_BARS = 500;
const HTF_BARS = 300;
const INTERVAL_MS: Record<string, number> = { "1h": 3_600_000, "4h": 14_400_000 };
const CACHE_TTL_MS = 60_000;

export interface SmcDeps {
  getCandles?: (symbol: string, interval: string, size: number) => Promise<Candle[]>;
  now?: () => number;
}

async function defaultGetCandles(symbol: string, interval: string, size: number): Promise<Candle[]> {
  // Lazy: the shared market-data instance pulls in provider env/server modules.
  const { marketData } = await import("@/services/market-data/shared-instance");
  return marketData.getTimeSeries({ symbol, interval, outputSize: size });
}

/** ISO timestamp, treating a zone-less provider time as UTC. */
function toIso(dt: string): string {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(dt);
  const t = new Date(hasZone ? dt : `${dt.replace(" ", "T")}Z`).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : dt;
}

const toSmc = (c: Candle): SmcCandle => ({ time: toIso(c.datetime), open: c.open, high: c.high, low: c.low, close: c.close });

/** Split provider candles (oldest first) into the closed ones and the live price. The last candle is the forming one unless its interval has already ended. */
export function splitClosed(candles: readonly Candle[], interval: string, nowMs: number): { closed: SmcCandle[]; livePrice: number } | null {
  if (candles.length < 2) return null;
  const all = candles.map(toSmc);
  const last = all[all.length - 1];
  const lastMs = new Date(last.time).getTime();
  const step = INTERVAL_MS[interval] ?? 3_600_000;
  const lastIsClosed = Number.isFinite(lastMs) && nowMs - lastMs >= step;
  return lastIsClosed ? { closed: all, livePrice: last.close } : { closed: all.slice(0, -1), livePrice: last.close };
}

const cache = new Map<string, { at: number; value: SmcAnalysis | null }>();
export function resetSmcCacheForTests(): void {
  cache.clear();
}

export async function getSmcAnalysis(symbol: string, deps: SmcDeps = {}): Promise<SmcAnalysis | null> {
  const now = deps.now ?? (() => Date.now());
  const key = symbol.toUpperCase();
  const hit = deps.getCandles ? undefined : cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value;

  const get = deps.getCandles ?? defaultGetCandles;
  let value: SmcAnalysis | null = null;
  try {
    const [ltfRaw, htfRaw] = await Promise.all([get(key, SMC_LTF, LTF_BARS), get(key, SMC_HTF, HTF_BARS).catch(() => [] as Candle[])]);
    const ltf = splitClosed(ltfRaw, SMC_LTF, now());
    const htf = splitClosed(htfRaw, SMC_HTF, now());
    if (ltf) value = analyzeSmc(ltf.closed, ltf.livePrice, htf ? htf.closed : null, DEFAULT_SMC_PARAMS);
  } catch {
    value = null;
  }
  if (!deps.getCandles) cache.set(key, { at: now(), value });
  return value;
}

/** The compact form the Signals cards show. */
export interface SmcSummary {
  lean: SmcAnalysis["lean"];
  strength: SmcAnalysis["strength"];
  score: number;
  bias: SmcAnalysis["bias"];
  htfBias: SmcAnalysis["htf"]["bias"];
}

export const summariseSmc = (a: SmcAnalysis): SmcSummary => ({ lean: a.lean, strength: a.strength, score: a.score, bias: a.bias, htfBias: a.htf.bias });
