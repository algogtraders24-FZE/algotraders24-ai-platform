/**
 * Q0.9 Part 7 - deterministic configuration hash. Same strategy + symbol +
 * timeframe + date range + capital + risk% must always produce the same
 * hash, with no random/time-based values folded in, so it can drive
 * idempotency (Part 26) and reproducibility (provenance, Part 20).
 */
import crypto from "node:crypto";
import type { BacktestRequest } from "@/types/quant-lite";

/** Recursively sorts object keys so JSON.stringify is order-independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Only the fields that actually change the engine's output participate in
 * the hash - anything cosmetic (e.g. a strategy's display `name`) is
 * intentionally excluded so a pure rename doesn't defeat idempotency.
 */
export function computeRequestHash(request: BacktestRequest): string {
  const semantic = {
    symbol: request.symbol,
    timeframe: request.timeframe,
    dateRange: request.dateRange,
    initialCapital: request.initialCapital,
    riskPct: request.riskPct,
    strategy: {
      indicators: request.strategy.indicators,
      entry_long: request.strategy.entry_long,
      entry_short: request.strategy.entry_short,
      risk: request.strategy.risk,
    },
  };
  const json = JSON.stringify(canonicalize(semantic));
  return crypto.createHash("sha256").update(json).digest("hex");
}
