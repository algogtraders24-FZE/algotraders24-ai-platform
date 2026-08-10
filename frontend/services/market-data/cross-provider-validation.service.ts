// services/market-data/cross-provider-validation.service.ts
// Sprint D2.6.4 - Provider Reliability, Smart Fallback & Cross-Provider
// Data Integrity. Compares two REAL, already-fetched MarketSnapshots for
// the same canonical instrument and reports where they agree or
// disagree - it never fetches data itself, never decides which provider
// is "correct", and never silently overwrites one value with another.
// This is deliberately an OPT-IN, standalone capability - callable when
// a caller genuinely has two real snapshots to compare - not wired into
// MarketDataService's default single-provider-wins hot path, so every
// existing consumer's request cost/latency is completely unchanged.
//
// Same "unresolved conflict, never auto-resolved" discipline as the
// existing 15D EvidenceRankingService.detectConflicts() (services/ai/
// evidence/evidence-ranking.service.ts) - this file follows that
// established precedent rather than inventing a new conflict philosophy.
import type { MarketSymbol } from "@/types/market";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { CrossProviderConflict, CrossProviderConflictStatus } from "@/types/provider-reliability";
import { assessFreshness } from "./freshness-policy.service";

export const CROSS_PROVIDER_VALIDATION_VERSION = "1.0.0";

/**
 * Relative tolerance for numeric price fields - two real, healthy
 * providers quoting the same instrument at nearly the same moment can
 * legitimately differ by their own bid/ask spread and quote timing, so
 * a small gap is "acceptable-difference", not a real conflict. Same
 * style of documented, untuned "V1 heuristic" as
 * EvidenceRankingService's own RELATIVE_TOLERANCE (0.005) - set
 * slightly looser here (0.01) because this compares two independent
 * VENDORS rather than two evidence claims from the same 15D pipeline
 * run, so a somewhat larger natural gap is expected and real.
 */
export const PRICE_RELATIVE_TOLERANCE = 0.01;

type NumericField = "price" | "open" | "high" | "low" | "close";
const NUMERIC_FIELDS: readonly NumericField[] = ["price", "open", "high", "low", "close"];

function fieldValue(snapshot: MarketSnapshot, field: NumericField): number | undefined {
  if (field === "price") return snapshot.price;
  return snapshot.ohlc?.[field];
}

function relativeDivergence(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return denom === 0 ? 0 : Math.abs(a - b) / denom;
}

export interface CompareSnapshotsInput {
  instrument: MarketSymbol;
  snapshotA: MarketSnapshot;
  snapshotB: MarketSnapshot;
  nowMs: number;
}

/**
 * Pure, deterministic. Returns one CrossProviderConflict per real,
 * comparable field found on BOTH snapshots (a field only one snapshot
 * has is never compared - "missing field" is honestly absent from the
 * result, never treated as a 0 vs. real-value conflict). Volume is
 * deliberately NOT compared: different providers' volume figures are
 * not confirmed to share a comparable unit/convention in this codebase
 * (e.g. Binance's base-asset 24h volume vs. a forex/equity provider's
 * own tick-volume definition) - comparing them risks a false "conflict"
 * finding that is actually just a unit mismatch, not real disagreement.
 */
export function compareSnapshots(input: CompareSnapshotsInput): CrossProviderConflict[] {
  const { snapshotA, snapshotB, nowMs } = input;
  const conflicts: CrossProviderConflict[] = [];
  const detectedAt = new Date(nowMs).toISOString();

  const freshnessA = assessFreshness({ subject: { kind: "quote", assetClass: snapshotA.assetClass }, timestamp: snapshotA.timestamp, nowMs });
  const freshnessB = assessFreshness({ subject: { kind: "quote", assetClass: snapshotB.assetClass }, timestamp: snapshotB.timestamp, nowMs });

  for (const field of NUMERIC_FIELDS) {
    const valueA = fieldValue(snapshotA, field);
    const valueB = fieldValue(snapshotB, field);
    if (valueA === undefined || valueB === undefined) continue; // not both real - nothing to compare, never a fabricated 0.

    const divergence = relativeDivergence(valueA, valueB);
    let status: CrossProviderConflictStatus;
    const basis: string[] = [];

    if (freshnessA.status === "stale" || freshnessB.status === "stale") {
      status = "stale-provider";
      basis.push(
        freshnessA.status === "stale"
          ? `${snapshotA.provider}'s data is stale (${freshnessA.ageMs}ms old, threshold ${freshnessA.thresholdMs}ms)`
          : `${snapshotB.provider}'s data is stale (${freshnessB.ageMs}ms old, threshold ${freshnessB.thresholdMs}ms)`,
        `The observed ${field} difference may simply reflect this staleness, not a real disagreement`,
      );
    } else if (divergence <= PRICE_RELATIVE_TOLERANCE) {
      status = "acceptable-difference";
      basis.push(`${field} divergence ${(divergence * 100).toFixed(3)}% is within the documented ${(PRICE_RELATIVE_TOLERANCE * 100).toFixed(1)}% tolerance`);
    } else {
      status = "unresolved-conflict";
      basis.push(
        `${field} divergence ${(divergence * 100).toFixed(3)}% exceeds the documented ${(PRICE_RELATIVE_TOLERANCE * 100).toFixed(1)}% tolerance while both providers report fresh data`,
        "Never auto-resolved - both real values are preserved for a downstream consumer to judge",
      );
    }

    conflicts.push({
      instrument: input.instrument,
      field,
      providerA: snapshotA.provider,
      providerB: snapshotB.provider,
      valueA,
      valueB,
      timestampA: snapshotA.timestamp,
      timestampB: snapshotB.timestamp,
      divergence,
      status,
      detectedAt,
      basis,
    });
  }

  // Timestamp comparison is its own field - a genuine mismatch in WHEN
  // each provider's data is from, independent of whether the price
  // values themselves agree.
  const timestampGapMs = Math.abs(new Date(snapshotA.timestamp).getTime() - new Date(snapshotB.timestamp).getTime());
  const timestampStatus: CrossProviderConflictStatus =
    freshnessA.status === "stale" || freshnessB.status === "stale" ? "stale-provider" : Number.isNaN(timestampGapMs) ? "unresolved-conflict" : "none";
  conflicts.push({
    instrument: input.instrument,
    field: "timestamp",
    providerA: snapshotA.provider,
    providerB: snapshotB.provider,
    valueA: snapshotA.timestamp,
    valueB: snapshotB.timestamp,
    timestampA: snapshotA.timestamp,
    timestampB: snapshotB.timestamp,
    status: timestampStatus,
    detectedAt,
    basis: [Number.isNaN(timestampGapMs) ? "One or both timestamps were not parseable" : `Timestamps are ${timestampGapMs}ms apart`],
  });

  return conflicts;
}
