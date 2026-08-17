// services/intelligence/decision/decision-context.service.ts
// Sprint D2.6.1 - Trader Intelligence Decision Context. Pure, synchronous,
// I/O-free transform: takes an already-assembled, VERIFIED
// IntelligenceEnvelope (D2.5.5) and restates it as a structured,
// trader-facing IntelligenceDecisionContext. No LLM, no network, no new
// indicator/risk/regime computation - every field is a direct passthrough
// or a deterministic derivation over real, already-computed values.
//
// PERMANENT PRODUCT PRINCIPLE: "AT24 does not tell the trader what to
// believe. It shows what the available evidence supports, what
// contradicts it, what could invalidate it, and how complete the
// intelligence is." This service never produces a BUY/SELL instruction,
// a target price, a stop loss, a win-rate claim, or a probability of
// profit/direction - see docs/architecture/D2.6.1-trader-decision-
// context-spec.md's "Prohibited outputs" section.
import type { MarketState } from "@/types/intelligence-market-state";
import type { Regime } from "@/types/intelligence-regime";
import type { Hypothesis } from "@/types/intelligence-hypothesis";
import type { EvidenceBundle, EvidenceItem } from "@/types/evidence";
import type { RiskProfile } from "@/types/risk-intelligence";
import type { HistoricalValidation } from "@/types/intelligence-historical-validation";
import type { IntelligenceEnvelope } from "@/types/intelligence-envelope";
import type { MicrostructureSnapshot } from "@/types/microstructure";
import { assessMicrostructureEvidence } from "@/services/intelligence/microstructure/microstructure-evidence-assessment.service";
import type {
  IntelligenceDecisionContext,
  DecisionCurrentState,
  DecisionRegimeContext,
  DecisionHypothesisContext,
  DecisionRiskContext,
  DecisionHistoricalContext,
  DecisionInvalidationItem,
  DecisionMonitoringItem,
  DecisionMissingInformationItem,
  DecisionState,
} from "@/types/intelligence-decision-context";

/**
 * Decision-state classification thresholds (sprint D2.6.1 §14) - an
 * explicit, documented "V1 heuristic," not statistically tuned, same
 * honesty labeling discipline as D2.5.5's score ceilings/weights. Reuses
 * IntelligenceScore's own already-computed evidenceAgreement component
 * for the "conflicted" check rather than inventing a second,
 * parallel conflict-counting formula.
 */
const WELL_SUPPORTED_SCORE_THRESHOLD = 70;
const CONFLICTED_EVIDENCE_AGREEMENT_THRESHOLD = 50;

function dedupEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const result: EvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.type}|${item.symbol}|${item.claim}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function buildCurrentState(marketState: MarketState): DecisionCurrentState {
  const trend = marketState.structure?.trend;
  const recentRange = marketState.structure?.recentRange;
  const basis: string[] = [`Live price ${marketState.snapshot.price} from provider "${marketState.snapshot.provider}"`];
  if (trend) basis.push(...trend.basis);
  if (recentRange) basis.push(`Recent range over ${recentRange.lookbackBars} bars: high ${recentRange.high}, low ${recentRange.low}`);
  if (marketState.structure?.volatilityBand) basis.push(`Volatility band: ${marketState.structure.volatilityBand}`);
  basis.push(marketState.dataQuality.note);

  return {
    price: marketState.snapshot.price,
    trendDirection: trend?.direction,
    priceAboveEma20: trend?.priceAboveEma20,
    ema20AboveEma50: trend?.ema20AboveEma50,
    rsi14: marketState.technical?.rsi14,
    atr14: marketState.technical?.atr14,
    volatilityBand: marketState.structure?.volatilityBand,
    recentRange,
    breakoutSignal: marketState.structure?.breakoutSignal,
    dataQuality: marketState.dataQuality,
    basis,
  };
}

function buildRegimeContext(regime: Regime): DecisionRegimeContext {
  return {
    regimeType: regime.regimeType,
    confidence: regime.confidence,
    basis: regime.basis,
    previousRegime: regime.previousRegime,
    transitionDetectedAt: regime.transitionDetectedAt,
    isReliable: regime.regimeType !== "insufficient-data",
  };
}

function buildHypothesisContexts(hypotheses: Hypothesis[]): DecisionHypothesisContext[] {
  return hypotheses.map((h) => ({
    hypothesisId: h.id,
    type: h.type,
    claim: h.statement.claim,
    predictionWindow: h.statement.predictionWindow,
    invalidationCondition: h.statement.invalidationCondition,
    requiredEvidence: h.requiredEvidence,
    supportingEvidence: h.supportingEvidence,
    opposingEvidence: h.opposingEvidence,
  }));
}

function buildRiskContext(risk?: RiskProfile): DecisionRiskContext {
  if (!risk) {
    return {
      overallLevel: undefined,
      categories: [],
      categoriesWithEvidence: [],
      categoriesUnavailable: [],
      basis: ["No RiskProfile supplied - risk context unavailable"],
      dataAvailable: false,
    };
  }
  const categoriesWithEvidence = risk.categories.filter((c) => c.basis.length > 0).map((c) => c.category);
  const categoriesUnavailable = risk.categories.filter((c) => c.basis.length === 0).map((c) => c.category);
  return {
    overallLevel: risk.overallLevel,
    categories: risk.categories,
    categoriesWithEvidence,
    categoriesUnavailable,
    basis: [
      `Overall risk level: ${risk.overallLevel}`,
      `${categoriesWithEvidence.length}/${risk.categories.length} risk categories backed by real, attributed evidence`,
    ],
    dataAvailable: true,
  };
}

function buildHistoricalContext(hv?: HistoricalValidation): DecisionHistoricalContext {
  if (!hv) {
    return { status: "unavailable", basis: ["No historical validation segment is available for this symbol/timeframe/regime/hypothesis combination"] };
  }
  if (hv.validatedRate === undefined) {
    return {
      status: "insufficient-sample",
      sampleSize: hv.sampleSize,
      validatedCount: hv.validatedCount,
      invalidatedCount: hv.invalidatedCount,
      inconclusiveCount: hv.inconclusiveCount,
      minSampleSize: hv.minSampleSize,
      basis: [`Sample size ${hv.sampleSize} is below the minimum required (${hv.minSampleSize}) - no rate is reported`],
    };
  }
  return {
    status: "available",
    sampleSize: hv.sampleSize,
    validatedCount: hv.validatedCount,
    invalidatedCount: hv.invalidatedCount,
    inconclusiveCount: hv.inconclusiveCount,
    validatedRate: hv.validatedRate,
    minSampleSize: hv.minSampleSize,
    basis: [`${hv.validatedCount}/${hv.sampleSize} historical hypotheses validated (${hv.inconclusiveCount} inconclusive, excluded from the rate)`],
  };
}

function buildInvalidationConditions(hypotheses: Hypothesis[]): DecisionInvalidationItem[] {
  return hypotheses.map((h) => ({
    hypothesisId: h.id,
    hypothesisType: h.type,
    description: h.statement.invalidationCondition.description,
    field: h.statement.invalidationCondition.field,
    comparator: h.statement.invalidationCondition.comparator,
    referenceValue: h.statement.invalidationCondition.referenceValue,
    basis: [`Derived from hypothesis "${h.type}" (id ${h.id}) - the exact condition recorded at generation time, never recalculated here`],
  }));
}

function buildMonitoringItems(
  marketState: MarketState,
  hypotheses: Hypothesis[],
  evidence: EvidenceBundle | undefined,
  historicalContext: DecisionHistoricalContext,
): DecisionMonitoringItem[] {
  const items: DecisionMonitoringItem[] = [];
  const trend = marketState.structure?.trend;
  const recentRange = marketState.structure?.recentRange;

  // MarketStateService always returns a real `trend` object (with an
  // honest "unavailable" basis) even when EMA20/EMA50 couldn't be
  // computed - `trend.direction` (not `trend` truthiness) is the real
  // signal for whether there is an actual, known trend condition worth
  // monitoring for a change.
  if (trend?.direction !== undefined) {
    items.push({
      category: "trend",
      description: `Monitor trend condition (currently "${trend.direction}") for a change in structure`,
      basis: trend.basis,
    });
  }
  if (recentRange) {
    items.push({
      category: "recent-range",
      description: `Monitor the recent-range boundary (high ${recentRange.high}, low ${recentRange.low}) for a breakout or breakdown`,
      basis: [`Recent range over ${recentRange.lookbackBars} bars`],
    });
  }
  if (marketState.structure?.volatilityBand) {
    items.push({
      category: "volatility",
      description: `Monitor volatility regime (currently "${marketState.structure.volatilityBand}") for expansion or contraction`,
      basis: [`ATR percent: ${marketState.structure.atrPercent ?? "unavailable"}`],
    });
  }
  const unresolvedConflicts = evidence?.conflicts.filter((c) => c.resolution === "unresolved") ?? [];
  if (unresolvedConflicts.length > 0) {
    items.push({
      category: "evidence-conflict",
      description: `Monitor ${unresolvedConflicts.length} unresolved evidence conflict(s) for resolution`,
      basis: unresolvedConflicts.map((c) => c.reason),
    });
  }
  for (const h of hypotheses) {
    items.push({
      category: "hypothesis-invalidation",
      description: `Monitor the invalidation condition for hypothesis "${h.type}": ${h.statement.invalidationCondition.description}`,
      basis: [h.statement.invalidationCondition.description],
    });
  }
  if (historicalContext.status !== "available") {
    items.push({
      category: "historical-sample",
      description: "Monitor the historical validation sample as it grows toward the minimum required for a reported rate",
      basis: historicalContext.basis,
    });
  }
  if (marketState.dataQuality.band !== "high") {
    items.push({
      category: "data-quality",
      description: `Monitor data quality (currently "${marketState.dataQuality.band}") as more candles/indicators become available`,
      basis: [marketState.dataQuality.note],
    });
  }
  return items;
}

function buildMissingInformation(envelope: IntelligenceEnvelope): DecisionMissingInformationItem[] {
  const items: DecisionMissingInformationItem[] = [];
  const structure = envelope.marketState.structure;

  // Permanent, structural non-implementations - never re-attempted, never penalized.
  items.push({ kind: "unsupported", description: "Liquidity zone data is not implemented in this Intelligence Engine version", affectedArea: "currentState.recentRange" });
  items.push({ kind: "unsupported", description: "Buy/sell volume delta data is not implemented in this Intelligence Engine version", affectedArea: "currentState" });
  items.push({ kind: "unsupported", description: "Execution risk (spread/slippage/latency) is not integrated in this platform by design", affectedArea: "riskContext" });
  items.push({ kind: "unsupported", description: "Liquidity risk (order book depth) has no data source in this platform", affectedArea: "riskContext" });

  // structure.trend is always a real object (MarketStateService returns
  // one with an honest "unavailable" basis even when EMA20/EMA50
  // couldn't be computed) - `trend.direction` is the real signal.
  if (structure?.trend?.direction === undefined) items.push({ kind: "insufficient-data", description: "Trend could not be computed (insufficient EMA data)", affectedArea: "currentState.trendDirection" });
  if (!structure?.recentRange) items.push({ kind: "insufficient-data", description: "Recent range could not be computed (insufficient candle history)", affectedArea: "currentState.recentRange" });
  if (envelope.marketState.technical?.rsi14 === undefined) items.push({ kind: "insufficient-data", description: "RSI14 could not be computed (insufficient candles)", affectedArea: "currentState.rsi14" });
  if (envelope.marketState.technical?.atr14 === undefined) items.push({ kind: "insufficient-data", description: "ATR14 could not be computed (insufficient candles)", affectedArea: "currentState.atr14" });

  if (!envelope.risk) items.push({ kind: "unavailable", description: "No RiskProfile was supplied to this analysis", affectedArea: "riskContext" });
  if (!envelope.evidence) items.push({ kind: "unavailable", description: "No EvidenceBundle was supplied to this analysis", affectedArea: "supportingEvidence / opposingEvidence" });
  if (!envelope.historicalValidation) {
    items.push({ kind: "unavailable", description: "No historical validation segment was supplied to this analysis", affectedArea: "historicalContext" });
  } else if (envelope.historicalValidation.validatedRate === undefined) {
    items.push({ kind: "insufficient-data", description: "Historical sample is below the minimum required for a reported validation rate", affectedArea: "historicalContext" });
  }

  return items;
}

function classifyState(envelope: IntelligenceEnvelope): { state: DecisionState; basis: string[] } {
  const basis: string[] = [];
  const regimeUnreliable = envelope.regime.regimeType === "insufficient-data";
  const overallScore = envelope.intelligenceScore.overallScore;

  if (regimeUnreliable || overallScore === undefined) {
    basis.push(
      regimeUnreliable
        ? `Regime is "insufficient-data" - the market cannot currently be characterized reliably`
        : "Intelligence Score could not be computed from any available component",
    );
    return { state: "insufficient-intelligence", basis };
  }

  const agreement = envelope.intelligenceScore.components.evidenceAgreement;
  if (agreement.dataAvailable && agreement.score < CONFLICTED_EVIDENCE_AGREEMENT_THRESHOLD) {
    basis.push(`Evidence Agreement score is ${agreement.score}/100 (below ${CONFLICTED_EVIDENCE_AGREEMENT_THRESHOLD}) - meaningful opposing evidence remains unresolved`);
    return { state: "conflicted", basis };
  }

  if (overallScore >= WELL_SUPPORTED_SCORE_THRESHOLD) {
    basis.push(`Intelligence Score is ${overallScore}/100 (at or above ${WELL_SUPPORTED_SCORE_THRESHOLD}) with no unresolved conflict pulling Evidence Agreement below ${CONFLICTED_EVIDENCE_AGREEMENT_THRESHOLD}`);
    return { state: "well-supported", basis };
  }

  basis.push(`Intelligence Score is ${overallScore}/100 (below ${WELL_SUPPORTED_SCORE_THRESHOLD}) - real intelligence exists but is incomplete`);
  return { state: "partially-supported", basis };
}

export class DecisionContextService {
  /**
   * Pure, deterministic: identical (envelope, microstructure) -> byte-
   * identical DecisionContext. No new clock read - generatedAt is reused
   * verbatim from the envelope.
   *
   * Sprint D2.8.11 - `microstructure` is a new, optional 2nd parameter,
   * defaulting to undefined so every existing caller (unmodified) behaves
   * byte-identically. When a real MicrostructureSnapshot is supplied,
   * `microstructureEvidence` is populated via the new, additive
   * assessMicrostructureEvidence() (services/intelligence/microstructure/
   * microstructure-evidence-assessment.service.ts) - a deterministic
   * comparison against the primary hypothesis's direction, never a second
   * hypothesis engine and never a numeric input to intelligenceScore
   * below. When omitted (the same "never attempted" case D2.8.8's own
   * AIPresenterOrchestratorService.present() already treats identically to
   * "attempted but unavailable"), `microstructureEvidence` is simply absent
   * from the result - this analysis makes no assertion about microstructure
   * either way.
   */
  build(envelope: IntelligenceEnvelope, microstructure?: MicrostructureSnapshot): IntelligenceDecisionContext {
    const currentState = buildCurrentState(envelope.marketState);
    const regimeContext = buildRegimeContext(envelope.regime);
    const primaryHypotheses = buildHypothesisContexts(envelope.hypotheses);
    const supportingEvidence = dedupEvidence(envelope.hypotheses.flatMap((h) => h.supportingEvidence));
    const opposingEvidence = dedupEvidence(envelope.hypotheses.flatMap((h) => h.opposingEvidence));
    const unresolvedConflicts = envelope.evidence?.conflicts.filter((c) => c.resolution === "unresolved") ?? [];
    const riskContext = buildRiskContext(envelope.risk);
    const historicalContext = buildHistoricalContext(envelope.historicalValidation);
    const invalidationConditions = buildInvalidationConditions(envelope.hypotheses);
    const monitoringItems = buildMonitoringItems(envelope.marketState, envelope.hypotheses, envelope.evidence, historicalContext);
    const missingInformation = buildMissingInformation(envelope);
    const { state, basis: stateBasis } = classifyState(envelope);
    // Sprint D2.8.11 - only attempted when a real snapshot was supplied;
    // the primary (first) hypothesis is what historicalContext/D2.5.4 also
    // treats as "the" hypothesis for this symbol/timeframe/regime.
    const microstructureEvidence = microstructure
      ? assessMicrostructureEvidence(microstructure, primaryHypotheses[0], envelope.generatedAt)
      : undefined;

    return {
      symbol: envelope.symbol,
      timeframe: envelope.timeframe,
      state,
      currentState,
      regimeContext,
      primaryHypotheses,
      supportingEvidence,
      opposingEvidence,
      unresolvedConflicts,
      riskContext,
      historicalContext,
      microstructureEvidence,
      intelligenceScore: envelope.intelligenceScore,
      invalidationConditions,
      monitoringItems,
      missingInformation,
      summaryBasis: [
        `Decision state: "${state}"`,
        ...stateBasis,
        `${primaryHypotheses.length} hypothesis(es), ${unresolvedConflicts.length} unresolved evidence conflict(s), ${monitoringItems.length} monitoring item(s), ${missingInformation.length} missing-information item(s)`,
      ],
      generatedAt: envelope.generatedAt,
      pipelineVersion: envelope.pipelineVersion,
      intelligenceEngineVersion: envelope.intelligenceEngineVersion,
    };
  }
}
