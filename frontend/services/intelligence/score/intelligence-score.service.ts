// services/intelligence/score/intelligence-score.service.ts
// Sprint D2.5.5 - Deterministic Intelligence Score & Intelligence Envelope.
// See docs/architecture/D2.5.5-intelligence-score-spec.md for the full,
// documented formula, weights, ceilings, and honesty rules this service
// implements. Pure, synchronous, I/O-free: no network call, no database
// read, no Gemini/Claude/OpenAI SDK import anywhere in this file, no
// Date.now()/Math.random() - `generatedAt` is always a caller-supplied
// parameter, matching the convention every prior D2.5.x/15D.6 service
// established (see risk-engine.service.ts's header).
//
// NON-NEGOTIABLE MEANING: this score measures the quality/completeness/
// agreement/risk-awareness/historical-support of the intelligence
// available to the system. It is NEVER a probability of profit, price
// direction, trade success, or an expected return - see
// types/intelligence-score.ts's header for the full statement.
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { MarketState } from "@/types/intelligence-market-state";
import type { Regime } from "@/types/intelligence-regime";
import type { Hypothesis } from "@/types/intelligence-hypothesis";
import type { EvidenceBundle } from "@/types/evidence";
import type { RiskProfile } from "@/types/risk-intelligence";
import type { HistoricalValidation } from "@/types/intelligence-historical-validation";
import type {
  IntelligenceScore,
  IntelligenceScoreComponent,
  IntelligenceScoreComponents,
  IntelligenceScoreComponentKey,
} from "@/types/intelligence-score";
import { MARKET_INTELLIGENCE_PIPELINE_VERSION } from "@/services/ai/market-intelligence-pipeline.service";
import { INTELLIGENCE_ENGINE_VERSION } from "@/services/intelligence/market-state/market-state.service";

export const INTELLIGENCE_SCORE_METHODOLOGY_VERSION = "1.0.0";

/**
 * V2 heuristic deterministic weights (sprint D2.5.5 §14), percentage
 * points summing to 100. NOT statistically optimized against real
 * outcome data - there isn't nearly enough of it yet (see D2.5.4's own
 * MIN_HISTORICAL_VALIDATION_SAMPLE note). Kept at the sprint brief's own
 * suggested values after an explicit audit (documented in the
 * architecture spec §6): Data Quality/Evidence Quality/MarketState
 * Quality/Regime Confidence are weighted highest (15 each) because they
 * are the primary, always-attemptable observation layer; Evidence
 * Agreement/Hypothesis Strength/Risk Awareness/Historical Validation are
 * weighted lower (10 each) because they are more derived, more often
 * sparse, or - for Historical Validation specifically - gated behind a
 * real sample-size minimum that most analyses won't meet for a long time.
 */
const WEIGHTS: Record<IntelligenceScoreComponentKey, number> = {
  dataQuality: 15,
  evidenceQuality: 15,
  evidenceAgreement: 10,
  marketStateQuality: 15,
  regimeConfidence: 15,
  hypothesisStrength: 10,
  riskAwareness: 10,
  historicalValidation: 10,
};

// Saturating target for the Hypothesis Strength evidence bonus - same
// "arbitrary but consistent, documented round-number target" style as
// services/ai/confidence/confidence-engine.service.ts's own
// EVIDENCE_QUANTITY_TARGET, not independently invented.
const HYPOTHESIS_STRENGTH_EVIDENCE_TARGET = 3;
const HYPOTHESIS_STRENGTH_BASELINE = 60;
const HYPOTHESIS_STRENGTH_EVIDENCE_BONUS_MAX = 40;

// Confidence ceilings (sprint §16): an explicit, documented cap so a
// fundamentally uninformed analysis can never report a high overall
// score just because a few peripheral components happened to look
// complete. Neither value is empirically tuned - both are conservative,
// clearly-labeled V2 heuristic constants.
const CEILING_INSUFFICIENT_REGIME = 40;
const CEILING_NO_MARKET_STATE = 25;

// Sprint §15's explicit "apply a data-completeness penalty when
// appropriate" - a small, documented per-missing-component deduction so
// a score built from only 2-3 available components never reads as
// equally trustworthy as a full 8-component score, even after weight
// renormalization.
const COMPLETENESS_PENALTY_PER_MISSING_COMPONENT = 2;

const PERMANENTLY_UNIMPLEMENTED_MARKET_STATE_FIELDS_NOTE =
  "liquidityZones/volumeDelta/bos/choch are not implemented in this Intelligence Engine version and are excluded from marketStateQuality, never penalized.";

const SCORE_MEANING_NOTE =
  "This score measures the quality and completeness of the intelligence available to the system. It is never a probability of profit, price direction, or trade success.";

export interface ComputeIntelligenceScoreInput {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  marketState?: MarketState;
  regime?: Regime;
  /** `undefined` = hypothesis generation was never attempted. `[]` = attempted, none produced (a real, honest outcome for 3 of 10 regime types). */
  hypotheses?: Hypothesis[];
  evidence?: EvidenceBundle;
  riskProfile?: RiskProfile;
  historicalValidation?: HistoricalValidation;
  /** Caller-supplied for determinism and testability - never Date.now() internally. */
  generatedAt: string;
}

function scoreDataQuality(marketState?: MarketState): IntelligenceScoreComponent {
  if (!marketState) {
    return { dataAvailable: false, score: undefined, basis: ["No MarketState supplied - data quality unknown"] };
  }
  const { computed, total, band, note } = marketState.dataQuality;
  const score = total > 0 ? Math.round((100 * computed) / total) : 0;
  const snapshotNote = marketState.snapshot.cached
    ? `Snapshot served from cache (age ${marketState.snapshot.cacheAgeMs ?? "unknown"}ms) - informational only, not penalized`
    : `Live snapshot from provider "${marketState.snapshot.provider}"`;
  return {
    dataAvailable: true,
    score,
    basis: [`${computed}/${total} tracked technical indicators computed (band: ${band})`, note, snapshotNote],
  };
}

function scoreEvidenceQuality(evidence?: EvidenceBundle): IntelligenceScoreComponent {
  if (!evidence) {
    return { dataAvailable: false, score: undefined, basis: ["No EvidenceBundle supplied - evidence quality unknown"] };
  }
  const total = evidence.items.length;
  if (total === 0) {
    return { dataAvailable: true, score: 0, basis: ["EvidenceBundle contains zero items - quality is genuinely zero, not unknown"] };
  }
  const attributed = evidence.items.filter((item) => item.source.trim().length > 0).length;
  const seen = new Set<string>();
  let unique = 0;
  for (const item of evidence.items) {
    const key = `${item.type}|${item.symbol}|${item.claim}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique += 1;
    }
  }
  const score = Math.round((100 * (attributed / total + unique / total)) / 2);
  return {
    dataAvailable: true,
    score,
    basis: [
      `${attributed}/${total} evidence item(s) have real source attribution`,
      `${unique}/${total} evidence item(s) are unique (non-duplicated by type+symbol+claim)`,
    ],
  };
}

function scoreEvidenceAgreement(evidence?: EvidenceBundle): IntelligenceScoreComponent {
  if (!evidence) {
    return { dataAvailable: false, score: undefined, basis: ["No EvidenceBundle supplied - agreement unknown"] };
  }
  const total = evidence.items.length;
  if (total === 0) {
    return {
      dataAvailable: false,
      score: undefined,
      basis: ["EvidenceBundle contains zero items - agreement is not applicable with nothing to compare"],
    };
  }
  const conflicting = new Set<string>();
  for (const conflict of evidence.conflicts) {
    conflicting.add(`${conflict.itemA.type}|${conflict.itemA.symbol}|${conflict.itemA.claim}`);
    conflicting.add(`${conflict.itemB.type}|${conflict.itemB.symbol}|${conflict.itemB.claim}`);
  }
  const conflictingFraction = Math.min(1, conflicting.size / total);
  const score = Math.round(100 * (1 - conflictingFraction));
  return {
    dataAvailable: true,
    score,
    basis: [
      `${evidence.conflicts.length} unresolved evidence conflict(s) out of ${total} evidence item(s)`,
      `${conflicting.size} evidence item(s) involved in at least one conflict - never auto-resolved`,
    ],
  };
}

function scoreMarketStateQuality(marketState?: MarketState): IntelligenceScoreComponent {
  if (!marketState) {
    return { dataAvailable: false, score: undefined, basis: ["No MarketState supplied - completeness unknown"] };
  }
  const { computed, total } = marketState.dataQuality;
  const technicalRatio = total > 0 ? computed / total : 0;
  const hasTrend = marketState.structure?.trend !== undefined;
  const hasRecentRange = marketState.structure?.recentRange !== undefined;
  const hasVolatility = marketState.structure?.volatilityBand !== undefined || marketState.structure?.atrPercent !== undefined;
  const checks = [technicalRatio, hasTrend ? 1 : 0, hasRecentRange ? 1 : 0, hasVolatility ? 1 : 0];
  const score = Math.round((100 * checks.reduce((sum, value) => sum + value, 0)) / checks.length);
  return {
    dataAvailable: true,
    score,
    basis: [
      `${computed}/${total} technical indicators computed`,
      hasTrend ? "Trend structure available" : "Trend structure unavailable (insufficient EMA data)",
      hasRecentRange ? "Recent range structure available" : "Recent range structure unavailable (insufficient candle history)",
      hasVolatility ? "Volatility band available" : "Volatility band unavailable (ATR not computable)",
      PERMANENTLY_UNIMPLEMENTED_MARKET_STATE_FIELDS_NOTE,
    ],
  };
}

function scoreRegimeConfidence(regime?: Regime): IntelligenceScoreComponent {
  if (!regime) {
    return { dataAvailable: false, score: undefined, basis: ["No Regime supplied - confidence unknown"] };
  }
  return {
    dataAvailable: true,
    score: regime.confidence,
    basis: [`Regime classified as "${regime.regimeType}"`, ...regime.basis],
  };
}

function scoreHypothesisStrength(hypotheses: Hypothesis[] | undefined, regime: Regime | undefined): IntelligenceScoreComponent {
  if (hypotheses === undefined) {
    return { dataAvailable: false, score: undefined, basis: ["Hypothesis generation was not attempted - strength unknown"] };
  }
  if (hypotheses.length === 0) {
    return {
      dataAvailable: true,
      score: 0,
      basis: [
        regime
          ? `No hypothesis was generated for regime "${regime.regimeType}" - hypothesis generation only applies to 7 of 10 regime types`
          : "No hypothesis was generated",
      ],
    };
  }
  const perHypothesisScores = hypotheses.map(
    (h) => HYPOTHESIS_STRENGTH_BASELINE + Math.min(1, h.supportingEvidence.length / HYPOTHESIS_STRENGTH_EVIDENCE_TARGET) * HYPOTHESIS_STRENGTH_EVIDENCE_BONUS_MAX,
  );
  const score = Math.round(perHypothesisScores.reduce((sum, value) => sum + value, 0) / perHypothesisScores.length);
  return {
    dataAvailable: true,
    score,
    basis: hypotheses.map(
      (h) =>
        `"${h.type}": ${h.supportingEvidence.length} supporting evidence item(s), ${h.opposingEvidence.length} opposing evidence item(s), invalidation condition and prediction window present`,
    ),
  };
}

function scoreRiskAwareness(riskProfile?: RiskProfile): IntelligenceScoreComponent {
  if (!riskProfile) {
    return { dataAvailable: false, score: undefined, basis: ["No RiskProfile supplied - risk awareness unknown"] };
  }
  const total = riskProfile.categories.length;
  const withBasis = riskProfile.categories.filter((c) => c.basis.length > 0);
  const withoutBasis = riskProfile.categories.filter((c) => c.basis.length === 0);
  const score = total > 0 ? Math.round((100 * withBasis.length) / total) : 0;
  return {
    dataAvailable: true,
    score,
    basis: [
      `${withBasis.length}/${total} risk categories backed by real, attributed evidence`,
      `With evidence: ${withBasis.map((c) => c.category).join(", ") || "none"}`,
      `Without evidence (RiskEngine's own honest "unmeasured" default, not a failure): ${withoutBasis.map((c) => c.category).join(", ") || "none"}`,
    ],
  };
}

function scoreHistoricalValidation(historicalValidation?: HistoricalValidation): IntelligenceScoreComponent {
  if (!historicalValidation) {
    return { dataAvailable: false, score: undefined, basis: ["No HistoricalValidation supplied - historical support unknown"] };
  }
  if (historicalValidation.validatedRate === undefined) {
    return {
      dataAvailable: false,
      score: undefined,
      basis: [
        `Historical sample below minimum validation threshold (sampleSize ${historicalValidation.sampleSize} < minSampleSize ${historicalValidation.minSampleSize})`,
      ],
    };
  }
  return {
    dataAvailable: true,
    score: Math.round(historicalValidation.validatedRate * 100),
    basis: [
      `${historicalValidation.validatedCount}/${historicalValidation.sampleSize} historical hypotheses validated for ${historicalValidation.symbol} ${historicalValidation.timeframe} / ${historicalValidation.regimeType} / ${historicalValidation.hypothesisType}`,
      `${historicalValidation.inconclusiveCount} inconclusive outcome(s) excluded from this rate`,
    ],
  };
}

const FORMULA_DESCRIPTION =
  "overallScore = round(sum(component.score * (weight / sum(weights of components with dataAvailable=true))) for eligible components) " +
  `minus ${COMPLETENESS_PENALTY_PER_MISSING_COMPONENT} point(s) per excluded component, clamped to [0,100], ` +
  `then capped by any applicable ceiling (${CEILING_INSUFFICIENT_REGIME} if regime is unavailable or "insufficient-data", ${CEILING_NO_MARKET_STATE} if MarketState is unavailable - the lower ceiling applies when both trigger). ` +
  "undefined only when every component is unavailable.";

export class IntelligenceScoreService {
  compute(input: ComputeIntelligenceScoreInput): IntelligenceScore {
    const components: IntelligenceScoreComponents = {
      dataQuality: scoreDataQuality(input.marketState),
      evidenceQuality: scoreEvidenceQuality(input.evidence),
      evidenceAgreement: scoreEvidenceAgreement(input.evidence),
      marketStateQuality: scoreMarketStateQuality(input.marketState),
      regimeConfidence: scoreRegimeConfidence(input.regime),
      hypothesisStrength: scoreHypothesisStrength(input.hypotheses, input.regime),
      riskAwareness: scoreRiskAwareness(input.riskProfile),
      historicalValidation: scoreHistoricalValidation(input.historicalValidation),
    };

    const keys = Object.keys(components) as IntelligenceScoreComponentKey[];
    const eligibleKeys = keys.filter((key) => components[key].dataAvailable);
    const basis: string[] = [];

    let overallScore: number | undefined;
    if (eligibleKeys.length === 0) {
      overallScore = undefined;
      basis.push("No components had available data - an intelligence score cannot be honestly computed.");
    } else {
      const eligibleWeightSum = eligibleKeys.reduce((sum, key) => sum + WEIGHTS[key], 0);
      let weighted = 0;
      for (const key of eligibleKeys) {
        const component = components[key];
        if (component.dataAvailable) {
          weighted += component.score * (WEIGHTS[key] / eligibleWeightSum);
        }
      }

      const missingKeys = keys.filter((key) => !components[key].dataAvailable);
      if (missingKeys.length > 0) {
        const penalty = missingKeys.length * COMPLETENESS_PENALTY_PER_MISSING_COMPONENT;
        basis.push(
          `${missingKeys.length}/${keys.length} component(s) excluded and weights renormalized across the remaining ${eligibleKeys.length}: ${missingKeys.join(", ")}.`,
        );
        basis.push(`Data-completeness penalty applied: -${penalty} point(s) (${COMPLETENESS_PENALTY_PER_MISSING_COMPONENT} per missing component).`);
        weighted -= penalty;
      } else {
        basis.push("All 8 components had available data - no renormalization or completeness penalty applied.");
      }

      const noMarketState = !input.marketState;
      const regimeInsufficient = !input.regime || input.regime.regimeType === "insufficient-data";
      let ceiling: number | undefined;
      if (noMarketState) {
        ceiling = CEILING_NO_MARKET_STATE;
        basis.push(`Ceiling applied: no MarketState supplied - overall score capped at ${CEILING_NO_MARKET_STATE}.`);
      } else if (regimeInsufficient) {
        ceiling = CEILING_INSUFFICIENT_REGIME;
        basis.push(`Ceiling applied: regime is unavailable or "insufficient-data" - overall score capped at ${CEILING_INSUFFICIENT_REGIME}.`);
      }

      let clamped = Math.max(0, Math.min(100, Math.round(weighted)));
      if (ceiling !== undefined) clamped = Math.min(clamped, ceiling);
      overallScore = clamped;
    }

    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      overallScore,
      components,
      methodology: {
        version: INTELLIGENCE_SCORE_METHODOLOGY_VERSION,
        formula: FORMULA_DESCRIPTION,
        weights: WEIGHTS,
      },
      basis,
      limitations: [PERMANENTLY_UNIMPLEMENTED_MARKET_STATE_FIELDS_NOTE, SCORE_MEANING_NOTE],
      generatedAt: input.generatedAt,
      pipelineVersion: MARKET_INTELLIGENCE_PIPELINE_VERSION,
      intelligenceEngineVersion: INTELLIGENCE_ENGINE_VERSION,
    };
  }
}
