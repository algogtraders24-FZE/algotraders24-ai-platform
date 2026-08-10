// services/market-data/market-snapshot-integrity.service.ts
// Sprint D2.6.4 - Provider Reliability, Smart Fallback & Cross-Provider
// Data Integrity. The "before a MarketSnapshot enters the Intelligence
// Engine" gate (sprint §8): validates symbol identity, provider
// identity, timestamp validity, price validity, OHLC internal
// consistency, and freshness (via freshness-policy.service.ts) - never
// manufactures a replacement value for anything invalid, only reports
// it. Pure, deterministic, no I/O.
//
// Deliberately a standalone, callable validator - not auto-wired into
// MarketDataService's existing getSnapshot() hot path this sprint (see
// the D2.6.4 architecture doc's scoping note). Every existing consumer
// of MarketDataService.getSnapshot() is completely unaffected; a future
// caller (or a later sprint) can invoke this explicitly before trusting
// a snapshot.
import type { MarketSymbol } from "@/types/market";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { MarketSnapshotIntegrityResult, MarketSnapshotIntegrityIssue } from "@/types/provider-reliability";
import { assessFreshness } from "./freshness-policy.service";

export const MARKET_SNAPSHOT_INTEGRITY_VERSION = "1.0.0";

export interface ValidateSnapshotIntegrityInput {
  /** The symbol the caller actually asked for - compared against the snapshot's own `symbol` to catch a silently-substituted instrument. */
  requestedSymbol: MarketSymbol;
  snapshot: MarketSnapshot;
  nowMs: number;
}

/** Pure: identical inputs always produce an identical result. */
export function validateSnapshotIntegrity(input: ValidateSnapshotIntegrityInput): MarketSnapshotIntegrityResult {
  const { snapshot, requestedSymbol, nowMs } = input;
  const issues: MarketSnapshotIntegrityIssue[] = [];

  if (snapshot.symbol !== requestedSymbol) {
    issues.push({ field: "symbol", description: `Snapshot symbol "${snapshot.symbol}" does not match the requested symbol "${requestedSymbol}" - never silently substituted` });
  }
  if (!snapshot.provider || snapshot.provider.trim().length === 0) {
    issues.push({ field: "provider", description: "Snapshot has no provider identity - cannot be trusted as real, attributed data" });
  }

  const timestampMs = new Date(snapshot.timestamp).getTime();
  if (Number.isNaN(timestampMs)) {
    issues.push({ field: "timestamp", description: `Snapshot timestamp "${snapshot.timestamp}" is not a parseable date` });
  }

  if (!Number.isFinite(snapshot.price) || snapshot.price <= 0) {
    issues.push({ field: "price", description: `Snapshot price (${snapshot.price}) is not a valid positive finite number` });
  }

  if (snapshot.ohlc) {
    const { open, high, low, close } = snapshot.ohlc;
    const allFinite = [open, high, low, close].every((v) => Number.isFinite(v));
    if (!allFinite) {
      issues.push({ field: "ohlc", description: "One or more OHLC values are not finite numbers" });
    } else if (!(low <= open && low <= close && high >= open && high >= close && high >= low)) {
      issues.push({ field: "ohlc", description: `OHLC is internally inconsistent: open=${open}, high=${high}, low=${low}, close=${close} (low must be <= open/close <= high)` });
    }
  }

  const freshness = assessFreshness({ subject: { kind: "quote", assetClass: snapshot.assetClass }, timestamp: snapshot.timestamp, nowMs });
  // Staleness is reported as its own field (freshnessStatus), never
  // folded into `valid` - the existing, approved stale-cache-fallback
  // mechanism (D2.3.S3/D2.6.3) already handles this honestly via
  // `cached`/`cacheAgeMs`; this validator's `valid` is about
  // STRUCTURAL/numeric integrity only, so a caller can distinguish
  // "this snapshot is malformed" from "this snapshot is real but old".

  return {
    symbol: requestedSymbol,
    valid: issues.length === 0,
    freshnessStatus: freshness.status,
    issues,
    checkedAt: new Date(nowMs).toISOString(),
  };
}
