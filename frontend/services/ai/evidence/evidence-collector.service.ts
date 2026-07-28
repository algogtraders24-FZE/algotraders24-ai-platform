// services/ai/evidence/evidence-collector.service.ts
// Sprint 15D.4 - Collects typed EvidenceItems from already-fetched market
// data. Does NOT call any MarketDataProvider itself - no network, no
// retrieval, no fabrication. It only normalizes what has already been
// returned by an existing 15D.1/15D.3A provider call
// (types/market-data-provider.ts's MarketContextResult) into the richer
// EvidenceItem shape (types/evidence.ts).
//
// Standalone: MarketDataProvider, MarketContextService, and
// AlphaVantageProvider are all unmodified and unaware this file exists.
//
// No-fabrication rule: an item is only ever emitted for a field the
// provider actually supplied. An absent optional field on
// MarketContextResult produces no item - never a placeholder one.
import type { MarketContextResult } from "@/types/market-data-provider";
import type { EvidenceItem } from "@/types/evidence";

export class EvidenceCollectorService {
  /**
   * Converts one provider's raw result into typed evidence items.
   * `retrievedAt` defaults to the result's own timestamp but can be
   * overridden (e.g. by a caller with its own clock) for determinism in
   * tests.
   */
  collectFromMarketContextResult(
    result: MarketContextResult,
    retrievedAt: string = result.retrievedAt,
  ): EvidenceItem[] {
    const items: EvidenceItem[] = [];

    // The provider's own evidence array is already a set of factual price
    // claims (see AlphaVantageProvider) - tag each as `price`.
    for (const raw of result.evidence) {
      items.push({
        type: "price",
        symbol: result.symbol,
        claim: raw.claim,
        source: raw.source,
        asOf: raw.asOf,
        retrievedAt,
      });
    }

    if (result.technicalSummary) {
      items.push({
        type: "technical",
        symbol: result.symbol,
        claim: result.technicalSummary,
        source: result.provider,
        asOf: result.retrievedAt,
        retrievedAt,
      });
    }

    if (result.trend) {
      items.push({
        type: "technical",
        symbol: result.symbol,
        claim: `Trend: ${result.trend}`,
        source: result.provider,
        asOf: result.retrievedAt,
        retrievedAt,
      });
    }

    if (result.headlines && result.headlines.length > 0) {
      for (const headline of result.headlines) {
        items.push({
          type: "news",
          symbol: result.symbol,
          claim: headline,
          source: result.provider,
          asOf: result.retrievedAt,
          retrievedAt,
        });
      }
    }

    if (result.sentiment) {
      items.push({
        type: "sentiment",
        symbol: result.symbol,
        claim: `Sentiment: ${result.sentiment}`,
        source: result.provider,
        asOf: result.retrievedAt,
        retrievedAt,
      });
    }

    if (result.riskNotes) {
      items.push({
        type: "provider-meta",
        symbol: result.symbol,
        claim: result.riskNotes,
        source: result.provider,
        asOf: result.retrievedAt,
        retrievedAt,
      });
    }

    // volatility/liquidity/riskLevel are categorical signals with no
    // dedicated EvidenceType home yet in this slice's minimal type set;
    // deliberately not collected rather than mis-tagging them - a future
    // sprint can extend EvidenceType instead of guessing here.

    return items;
  }

  /** Merges already-collected evidence groups (e.g. from multiple providers) into one pool. Order-preserving; ranking (not this method) determines presentation order. */
  merge(...groups: readonly EvidenceItem[][]): EvidenceItem[] {
    return groups.flat();
  }
}
