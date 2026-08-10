// types/intelligence-envelope.ts
// Sprint D2.5.5 - Deterministic Intelligence Score & Intelligence Envelope
// (Intelligence Engine V2, phase 5). See
// docs/architecture/D2.5.5-intelligence-score-spec.md §11-13 for the full
// architectural rationale.
//
// This is the single most important boundary this sprint adds: the
// IntelligenceEnvelope is the canonical, VERIFIED bundle of everything the
// deterministic engines (D2.5.1-D2.5.5) actually know about a symbol at
// one point in time. It is assembled ONLY from real, already-computed
// values (see services/intelligence/envelope/intelligence-envelope.
// service.ts - a pure, I/O-free function, no exceptions). Nothing in this
// file is ever populated by an LLM.
//
// The AIIntelligencePresenter interface below is the ONLY sanctioned way
// an AI model may touch this data. Its return type
// (AIPresentationResult) structurally cannot carry a new market fact, a
// new evidence item, a new hypothesis, a changed regime, a changed risk
// level, or a changed historical-validation number - it can only return
// prose text plus provenance metadata about an envelope it was handed.
// The presenter receives verified intelligence and presents it; it is
// never the source of it. This is a permanent architectural rule (D2.5.5
// §27 / §18-20), not a stylistic preference - do not add a field to
// AIPresentationResult that would let a future presenter smuggle a new
// fact back into the system.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { MarketState } from "./intelligence-market-state";
import type { Regime } from "./intelligence-regime";
import type { Hypothesis } from "./intelligence-hypothesis";
import type { EvidenceBundle, EvidenceConflict } from "./evidence";
import type { RiskProfile } from "./risk-intelligence";
import type { ConfidenceProfile } from "./confidence-intelligence";
import type { HistoricalValidation } from "./intelligence-historical-validation";
import type { IntelligenceScore } from "./intelligence-score";

export interface IntelligenceEnvelope {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;

  /** D2.5.2 - always required; an envelope cannot exist without a real observation layer. */
  marketState: MarketState;
  /** D2.5.2 - always required; classifies the marketState above. */
  regime: Regime;
  /** D2.5.3 - may legitimately be empty (regimeType constrains generation to 7 of 10 regime types - see hypothesis.service.ts). Never fabricated to avoid an empty array. */
  hypotheses: Hypothesis[];

  /** 15D.4 - optional: an envelope can be assembled from just MarketState/Regime/Hypothesis with no EvidenceBundle supplied. Never a second, parallel evidence system - this is the same EvidenceBundle the rest of the platform uses. */
  evidence?: EvidenceBundle;
  /** Convenience mirror of evidence?.conflicts (never re-derived, never a separate detection pass) - [] when evidence is present with no conflicts, absent only when evidence itself is absent. */
  conflicts?: EvidenceConflict[];
  /** 15D.6 - optional, reused verbatim. */
  risk?: RiskProfile;
  /**
   * 15D.7 - optional, reused verbatim, included for the AI presenter's
   * awareness only. This is the EXISTING "model confidence"-adjacent
   * concept and is architecturally DISTINCT from `intelligenceScore`
   * below - see the spec §4 for why the two must never be conflated in
   * anything a presenter says to a user.
   */
  confidence?: ConfidenceProfile;
  /**
   * D2.5.4 - optional. The HistoricalValidation segment for this
   * envelope's hypothesis, when exactly one hypothesis is present
   * (matches D2.5.3's current at-most-one-hypothesis-per-regime
   * behavior). `undefined` whenever no hypothesis exists, no historical
   * sample exists yet, or more than one hypothesis is present (a future
   * sprint generating multiple simultaneous hypotheses would need a
   * multi-segment shape here - not built ahead of that real need).
   */
  historicalValidation?: HistoricalValidation;

  /** D2.5.5 - the deterministic, explainable quality score for everything above. Never a probability of profit/direction - see types/intelligence-score.ts's header. */
  intelligenceScore: IntelligenceScore;

  generatedAt: string;
  /** The underlying Sprint 15D pipeline version this envelope's optional Evidence/Risk/Confidence inputs are contract-compatible with (e.g. "15D.12.0"). */
  pipelineVersion: string;
  /** Same Intelligence Engine V2 version as every other D2.5.x contract (e.g. "2.0.0"). */
  intelligenceEngineVersion: string;
}

/**
 * The only fields an AI presenter may ever return. Deliberately narrow:
 * no `evidence`, no `hypothesis`, no `regime`, no `riskLevel`, no
 * `historicalValidation`, no numeric score field of any kind. A
 * presenter that wants to reference the score/evidence/risk must restate
 * what the envelope already says in `text` - it cannot hand back a
 * structured value the rest of the system might mistake for a new,
 * independently-sourced fact.
 */
export interface AIPresentationResult {
  /** The presenter's natural-language response to the user's question, grounded only in the supplied envelope. */
  text: string;
  /** Which presenter produced this, e.g. "gemini" - for logging/auditing, never used to imply independent verification. */
  presentedBy: string;
  /** Echoes the envelope's own generatedAt - lets a caller detect a stale envelope was presented, never a new timestamp claim. */
  envelopeGeneratedAt: string;
}

/**
 * Provider-independent boundary between verified intelligence and its
 * natural-language presentation. D2.5.5 defines this interface only - no
 * concrete implementation (Gemini/Claude/OpenAI) is wired up in this
 * sprint. See the spec §12-13 for the planned GeminiPresenter/
 * ClaudePresenter/OpenAIPresenter shape this is designed to support
 * without a breaking change.
 */
export interface AIIntelligencePresenter {
  /** e.g. "gemini" - identifies which underlying model implements this presenter. */
  readonly name: string;
  /**
   * Presents an already-verified IntelligenceEnvelope in response to a
   * user's question. MUST NOT add market facts, invent evidence, create
   * hypotheses, change the regime, change risk, change historical
   * validation, or override a conflict - the envelope is read-only input.
   */
  present(envelope: IntelligenceEnvelope, userQuestion: string): Promise<AIPresentationResult>;
}
