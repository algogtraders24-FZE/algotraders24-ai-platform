// services/ai/reasoning/reasoning-engine.service.ts
// Sprint 15D.5 - Reasoning Intelligence Engine. Standalone, deterministic,
// AI-provider independent: consumes a Sprint 15D.4 EvidenceBundle
// (unmodified) and produces a ReasoningResult using only counting,
// grouping, and timestamp comparison - no model call, no prompt, no
// randomness, no Date.now() (every timestamp is a caller-supplied
// parameter, exactly like EvidenceRankingService). Nothing in this file
// touches the AI provider layer, MarketDataProvider, or any Gemini code.
import type { EvidenceItem, EvidenceConflict, EvidenceType, EvidenceBundle } from "@/types/evidence";
import type {
  Assumption,
  ConfidenceDriver,
  RiskDriver,
  Uncertainty,
  ReasoningResult,
} from "@/types/reasoning";
import type { RiskLevel } from "@/types/risk";

// Mirrors the EvidenceType union in types/evidence.ts. Kept as an explicit
// list (rather than derived at runtime from a TS type, which isn't
// possible) so "which types are missing" is computable.
const ALL_EVIDENCE_TYPES: readonly EvidenceType[] = [
  "price",
  "technical",
  "news",
  "macro",
  "sentiment",
  "historical-pattern",
  "cross-asset",
  "provider-meta",
];

const FRESHNESS_WARNING_MINUTES = 15;
const FRESHNESS_STALE_MINUTES = 60;

export class ReasoningEngineService {
  /**
   * Produces a deterministic ReasoningResult for one symbol's evidence
   * bundle. `generatedAt` defaults to the bundle's own timestamp but can
   * be overridden by a caller with its own clock, for determinism in
   * tests - this method itself never reads the system clock.
   */
  reason(bundle: EvidenceBundle, generatedAt: string = bundle.generatedAt): ReasoningResult {
    const { supporting, opposing, unresolved } = this.classify(bundle.items, bundle.conflicts);
    const assumptions = this.buildAssumptions(bundle.items);
    const freshestAgeMinutes = this.freshestAgeMinutes(bundle.items, generatedAt);
    const missingTypeCount = ALL_EVIDENCE_TYPES.length - this.presentTypes(bundle.items).size;

    const uncertainty = this.buildUncertainty(missingTypeCount, bundle.conflicts.length, freshestAgeMinutes);
    const confidenceDrivers = this.buildConfidenceDrivers(bundle, missingTypeCount, freshestAgeMinutes);
    const riskDrivers = this.buildRiskDrivers(missingTypeCount, bundle.conflicts.length, freshestAgeMinutes);

    return {
      symbol: bundle.symbol,
      supportingEvidence: supporting,
      opposingEvidence: opposing,
      conflicts: bundle.conflicts,
      unresolvedItems: unresolved,
      assumptions,
      uncertainty,
      confidenceDrivers,
      riskDrivers,
      generatedAt,
    };
  }

  // Every item ends up in exactly one of the three buckets (mutually
  // exclusive, collectively exhaustive over `items`):
  //   - zero conflicts against it within its type group -> supporting
  //   - a determinable minority within a conflicted group -> opposing
  //   - a symmetric/ambiguous conflict with no determinable majority -> unresolved
  // No item is ever classified by inventing a stance it didn't earn from
  // the conflict data already computed in Sprint 15D.4.
  private classify(
    items: readonly EvidenceItem[],
    conflicts: readonly EvidenceConflict[],
  ): { supporting: EvidenceItem[]; opposing: EvidenceItem[]; unresolved: EvidenceItem[] } {
    const groups = new Map<string, EvidenceItem[]>();
    for (const item of items) {
      const key = `${item.symbol}::${item.type}`;
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }

    const supporting: EvidenceItem[] = [];
    const opposing: EvidenceItem[] = [];
    const unresolved: EvidenceItem[] = [];

    for (const group of groups.values()) {
      if (group.length === 1) {
        supporting.push(group[0]);
        continue;
      }

      const conflictCount = new Map<EvidenceItem, number>(group.map((item) => [item, 0]));
      for (const conflict of conflicts) {
        if (group.includes(conflict.itemA) && group.includes(conflict.itemB)) {
          conflictCount.set(conflict.itemA, (conflictCount.get(conflict.itemA) ?? 0) + 1);
          conflictCount.set(conflict.itemB, (conflictCount.get(conflict.itemB) ?? 0) + 1);
        }
      }

      const zero = group.filter((item) => conflictCount.get(item) === 0);
      const contested = group.filter((item) => (conflictCount.get(item) ?? 0) > 0);

      supporting.push(...zero);

      if (contested.length === 0) continue;

      const counts = contested.map((item) => conflictCount.get(item) ?? 0);
      const min = Math.min(...counts);
      const max = Math.max(...counts);

      if (min === max) {
        // Every contested item disagrees with the group equally often -
        // no determinable majority. Honest outcome: unresolved, not a
        // coin-flip winner.
        unresolved.push(...contested);
        continue;
      }

      for (const item of contested) {
        const count = conflictCount.get(item) ?? 0;
        if (count === min) supporting.push(item);
        else if (count === max) opposing.push(item);
        else unresolved.push(item);
      }
    }

    return { supporting, opposing, unresolved };
  }

  private presentTypes(items: readonly EvidenceItem[]): Set<EvidenceType> {
    return new Set(items.map((item) => item.type));
  }

  // One deterministic statement per absent EvidenceType - derived purely
  // from what's missing, never a guess about what the missing evidence
  // might have said.
  private buildAssumptions(items: readonly EvidenceItem[]): Assumption[] {
    const present = this.presentTypes(items);
    return ALL_EVIDENCE_TYPES.filter((type) => !present.has(type)).map((type) => ({
      type,
      statement: `No ${type} evidence was available; this reasoning does not account for ${type} factors.`,
    }));
  }

  // Age (in whole minutes) of the single freshest item relative to
  // `generatedAt`. Undefined when there is no evidence at all - never
  // fabricated as zero.
  private freshestAgeMinutes(items: readonly EvidenceItem[], generatedAt: string): number | undefined {
    if (items.length === 0) return undefined;
    const generatedMs = new Date(generatedAt).getTime();
    const newestAsOfMs = Math.max(...items.map((item) => new Date(item.asOf).getTime()));
    return Math.max(0, Math.round((generatedMs - newestAsOfMs) / 60_000));
  }

  private buildUncertainty(
    missingTypeCount: number,
    conflictCount: number,
    freshestAgeMinutes: number | undefined,
  ): Uncertainty {
    const coveragePenalty = Math.round((50 * missingTypeCount) / ALL_EVIDENCE_TYPES.length);
    const conflictPenalty = Math.min(30, conflictCount * 10);
    const stalenessPenalty =
      freshestAgeMinutes === undefined
        ? 0
        : freshestAgeMinutes > FRESHNESS_STALE_MINUTES
          ? 20
          : freshestAgeMinutes > FRESHNESS_WARNING_MINUTES
            ? 10
            : 0;

    const score = Math.min(100, coveragePenalty + conflictPenalty + stalenessPenalty);

    const reasons: string[] = [];
    if (missingTypeCount > 0) reasons.push(`${missingTypeCount} of ${ALL_EVIDENCE_TYPES.length} evidence types unavailable`);
    if (conflictCount > 0) reasons.push(`${conflictCount} unresolved conflict(s) detected`);
    if (freshestAgeMinutes !== undefined && freshestAgeMinutes > FRESHNESS_WARNING_MINUTES) {
      reasons.push(`Freshest evidence is ${freshestAgeMinutes} minute(s) old`);
    }

    return { score, reasons };
  }

  private buildConfidenceDrivers(
    bundle: EvidenceBundle,
    missingTypeCount: number,
    freshestAgeMinutes: number | undefined,
  ): ConfidenceDriver[] {
    const totalItems = bundle.items.length;
    const presentTypeCount = ALL_EVIDENCE_TYPES.length - missingTypeCount;
    const conflictCount = bundle.conflicts.length;

    const drivers: ConfidenceDriver[] = [
      {
        factor: "evidence-volume",
        detail: `${totalItems} evidence item(s) collected`,
        impact: totalItems > 0 ? "positive" : "negative",
      },
      {
        factor: "coverage",
        detail: `${presentTypeCount} of ${ALL_EVIDENCE_TYPES.length} evidence types present`,
        impact: presentTypeCount * 2 >= ALL_EVIDENCE_TYPES.length ? "positive" : "negative",
      },
      {
        factor: "conflicts",
        detail: `${conflictCount} unresolved conflict(s) detected`,
        impact: conflictCount === 0 ? "positive" : "negative",
      },
    ];

    if (freshestAgeMinutes !== undefined) {
      drivers.push({
        factor: "freshness",
        detail: `Freshest evidence is ${freshestAgeMinutes} minute(s) old`,
        impact: freshestAgeMinutes <= FRESHNESS_WARNING_MINUTES ? "positive" : "negative",
      });
    }

    return drivers;
  }

  private buildRiskDrivers(
    missingTypeCount: number,
    conflictCount: number,
    freshestAgeMinutes: number | undefined,
  ): RiskDriver[] {
    const gapRatio = missingTypeCount / ALL_EVIDENCE_TYPES.length;
    const dataGapLevel: RiskLevel = gapRatio >= 0.75 ? "high" : gapRatio >= 0.5 ? "medium" : "low";
    const conflictLevel: RiskLevel = conflictCount >= 2 ? "high" : conflictCount === 1 ? "medium" : "low";

    const drivers: RiskDriver[] = [
      {
        factor: "data-gap",
        detail: `${missingTypeCount} of ${ALL_EVIDENCE_TYPES.length} evidence types missing`,
        level: dataGapLevel,
      },
      {
        factor: "conflict",
        detail: `${conflictCount} unresolved conflict(s)`,
        level: conflictLevel,
      },
    ];

    if (freshestAgeMinutes !== undefined) {
      const stalenessLevel: RiskLevel =
        freshestAgeMinutes > FRESHNESS_STALE_MINUTES ? "high" : freshestAgeMinutes > FRESHNESS_WARNING_MINUTES ? "medium" : "low";
      drivers.push({
        factor: "staleness",
        detail: `Freshest evidence is ${freshestAgeMinutes} minute(s) old`,
        level: stalenessLevel,
      });
    }

    return drivers;
  }
}
