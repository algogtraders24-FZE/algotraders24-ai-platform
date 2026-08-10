// types/intelligence-score.ts
// Sprint D2.5.5 - Deterministic Intelligence Score & Intelligence Envelope
// (Intelligence Engine V2, phase 5). See
// docs/architecture/D2.5.5-intelligence-score-spec.md for the full
// contract, formula, and honesty rules this type exists to enforce.
//
// NON-NEGOTIABLE MEANING (repeat this before touching this file): the
// Intelligence Score measures the QUALITY, COMPLETENESS, AGREEMENT,
// RISK-AWARENESS, and HISTORICAL SUPPORT of the evidence and reasoning
// context available to the system. It is NEVER a probability of profit,
// a probability of price direction, a trade-success probability, a
// BUY/SELL confidence, an expected return, or a prediction-accuracy claim.
// "Intelligence quality score: 85/100" is correct. "85% chance of
// winning" is not just imprecise, it is a different, false claim - never
// phrase it that way anywhere this type is displayed or logged.
//
// Missing-data discipline: every component is a discriminated union.
// `dataAvailable: true` guarantees a real `score: number` (0-100).
// `dataAvailable: false` guarantees `score: undefined` - the type system
// itself makes "silently treat unknown as 0" and "silently treat unknown
// as 100" impossible to write by accident. `basis` always explains WHY,
// whether the component is a genuine "known weak" (real score, low),
// "unknown" (no data supplied to score from), or "not applicable" (the
// data legitimately doesn't apply here, e.g. zero evidence items exist to
// measure agreement between) - the last two both collapse to
// `dataAvailable: false`, distinguished only by the `basis` text, since
// the sprint's own contract does not ask for a third enum state.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";

/** A component whose score was genuinely computable from real data. */
export interface IntelligenceScoreComponentAvailable {
  dataAvailable: true;
  /** 0-100. Never a raw 0-1 fraction - see the spec's §3 representation rule. */
  score: number;
  /** Deterministic, human-readable explanation - never empty. */
  basis: string[];
}

/** A component that could not be honestly scored - unknown or not applicable. Never silently defaulted to 0 or 100. */
export interface IntelligenceScoreComponentUnavailable {
  dataAvailable: false;
  score: undefined;
  /** Must explain why: "no data supplied" (unknown) vs. "genuinely nothing to measure" (not applicable) - never left generic. */
  basis: string[];
}

export type IntelligenceScoreComponent = IntelligenceScoreComponentAvailable | IntelligenceScoreComponentUnavailable;

export interface IntelligenceScoreComponents {
  /** Quality/completeness of the raw market input (MarketState.dataQuality + snapshot). */
  dataQuality: IntelligenceScoreComponent;
  /** Attribution and non-duplication of the real EvidenceBundle's items. */
  evidenceQuality: IntelligenceScoreComponent;
  /** How internally consistent the evidence is - real, already-detected conflicts vs. total items. Never auto-resolves a conflict. */
  evidenceAgreement: IntelligenceScoreComponent;
  /** Structural completeness of MarketState (trend/recentRange/volatilityBand availability) - never penalizes the permanently-unimplemented fields (liquidityZones/volumeDelta/bos/choch). */
  marketStateQuality: IntelligenceScoreComponent;
  /** Reused verbatim from Regime.confidence (D2.5.2) - never recomputed. */
  regimeConfidence: IntelligenceScoreComponent;
  /** Quality/completeness of the generated Hypothesis[] (D2.5.3) as a falsifiable claim - never a probability the hypothesis will succeed. */
  hypothesisStrength: IntelligenceScoreComponent;
  /** Fraction of RiskProfile's 8 fixed categories backed by real, attributed evidence - never a risk-level judgment ("this trade is safe"). */
  riskAwareness: IntelligenceScoreComponent;
  /** Reused verbatim from HistoricalValidation (D2.5.4) - unavailable (never 0) below MIN_HISTORICAL_VALIDATION_SAMPLE. */
  historicalValidation: IntelligenceScoreComponent;
}

export type IntelligenceScoreComponentKey = keyof IntelligenceScoreComponents;

export interface IntelligenceScoreMethodology {
  /** Independent of intelligenceEngineVersion - bumps only when the scoring formula/weights/component logic itself changes. */
  version: string;
  /** Human-readable description of the exact computation - see the spec for the full worked formula. */
  formula: string;
  /** The 8 component weights as configured, in percentage points (0-100), always summing to 100 before any per-run renormalization. Labeled explicitly as a "V2 heuristic" - not statistically optimized. */
  weights: Record<IntelligenceScoreComponentKey, number>;
}

export interface IntelligenceScore {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  /**
   * 0-100. `undefined` only in the total-blackout case where every single
   * component was unavailable - an honest "cannot be computed" result,
   * never a fabricated placeholder. In every other case this is a real
   * number, but see `methodology`/`limitations` for whether it was
   * renormalized across fewer than 8 components and whether a ceiling
   * (§16) was applied.
   */
  overallScore: number | undefined;
  components: IntelligenceScoreComponents;
  methodology: IntelligenceScoreMethodology;
  /** Top-level rollup: which components were excluded, which ceilings/penalties applied, and why - never just the raw number with no explanation. */
  basis: string[];
  /** Permanent and per-run caveats - e.g. "liquidityZones/volumeDelta/bos/choch are not implemented in this Intelligence Engine version and are excluded from marketStateQuality, not penalized." Always non-empty. */
  limitations: string[];
  generatedAt: string;
  /** The underlying Sprint 15D pipeline version this score's optional Evidence/Risk inputs are contract-compatible with (e.g. "15D.12.0") - NOT bumped by this sprint. */
  pipelineVersion: string;
  /** Same Intelligence Engine V2 version as MarketState/Regime/Hypothesis (e.g. "2.0.0"). */
  intelligenceEngineVersion: string;
}
