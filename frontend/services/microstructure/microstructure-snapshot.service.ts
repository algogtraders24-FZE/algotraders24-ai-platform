// services/microstructure/microstructure-snapshot.service.ts
// Sprint D2.8.5, Phases 2/3/5 composed - the single place a
// RawMicrostructureResult (a provider adapter's raw evidence) becomes a
// complete, provider-neutral MicrostructureSnapshot. Deliberately NOT a
// priority/fallback chain across providers the way MarketDataService is
// for OHLC/quote data: microstructure evidence is inherently venue-
// specific (D2.8.2/D2.8.3/D2.8.4's own established rule - a Binance order
// book can never stand in for an Angel One or Dukascopy one), so this
// service always operates on exactly one caller-supplied provider, never
// silently substituting a different venue's data for it.
import type { MarketDataProvider, MarketContextRequest } from "@/types/market-data-provider";
import { isMicrostructureProvider } from "@/types/microstructure-provider";
import type { MicrostructureSnapshot, RawMicrostructureResult } from "@/types/microstructure";
import { MICROSTRUCTURE_CONTRACT_VERSION } from "@/types/microstructure";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { systemClock, type Clock } from "@/lib/market-data/cache";
import { assessMicrostructureFreshness } from "@/lib/microstructure/microstructure-validation";
import {
  computeMidPrice,
  computeSpread,
  computeSideDepth,
  computeDepthImbalance,
  computeAggressorVolumes,
  computeVolumeDelta,
  computeLiquidityConcentration,
} from "@/lib/microstructure/microstructure-calculation";

/**
 * Pure: identical raw evidence + identical nowMs always produces an
 * identical snapshot. Runs every Phase-3 calculation over the raw
 * evidence's already-validated fields and stamps the overall snapshot-
 * level freshness (Phase 5) - never mutates the raw evidence itself.
 */
export function buildMicrostructureSnapshot(raw: RawMicrostructureResult, nowMs: number): MicrostructureSnapshot {
  const freshnessStatus = assessMicrostructureFreshness(raw.timestamp, raw.assetClass, nowMs);

  const midPrice = computeMidPrice(raw.evidence.bid, raw.evidence.ask);
  const spread = computeSpread(raw.evidence.bid, raw.evidence.ask);
  const bidDepth = computeSideDepth(raw.evidence.bidLevels);
  const askDepth = computeSideDepth(raw.evidence.askLevels);
  const depthImbalance = computeDepthImbalance(bidDepth, askDepth);
  const { buyVolume, sellVolume } = computeAggressorVolumes(raw.evidence.trades);
  const volumeDelta = computeVolumeDelta(buyVolume, sellVolume);
  const liquidityConcentration = computeLiquidityConcentration(raw.evidence.bidLevels, raw.evidence.askLevels);

  return {
    symbol: raw.symbol,
    provider: raw.provider,
    assetClass: raw.assetClass,
    timestamp: raw.timestamp,
    retrievedAt: raw.retrievedAt,
    freshnessStatus,
    evidence: raw.evidence,
    derived: { midPrice, spread, bidDepth, askDepth, depthImbalance, buyVolume, sellVolume, volumeDelta, liquidityConcentration },
    generatedAt: new Date(nowMs).toISOString(),
    version: MICROSTRUCTURE_CONTRACT_VERSION,
  };
}

export class MicrostructureSnapshotService {
  constructor(private readonly clock: Clock = systemClock) {}

  /**
   * Capability-checked exactly like MarketDataService.getSnapshot()'s own
   * isSnapshotProvider() gate: a provider without getMicrostructureSnapshot
   * is a real, reported error (unsupported_symbol-shaped), never a silent
   * empty snapshot. No provider list, no fallback - the caller names the
   * exact provider/venue it wants evidence from.
   */
  async getSnapshot(provider: MarketDataProvider, request: MarketContextRequest): Promise<MicrostructureSnapshot> {
    if (!isMicrostructureProvider(provider)) {
      throw new MarketDataProviderError("unsupported_symbol", `${provider.name} does not implement microstructure evidence`, provider.name);
    }
    if (!provider.isConfigured()) {
      throw new MarketDataProviderError("unconfigured", `${provider.name} is not configured`, provider.name);
    }
    const raw = await provider.getMicrostructureSnapshot(request);
    return buildMicrostructureSnapshot(raw, this.clock.now());
  }
}
