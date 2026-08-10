// services/intelligence/envelope/intelligence-envelope.service.ts
// Sprint D2.5.5 - Deterministic Intelligence Score & Intelligence
// Envelope. Pure, synchronous, I/O-free assembler: takes already-computed
// MarketState/Regime/Hypothesis[]/EvidenceBundle/RiskProfile/
// ConfidenceProfile/HistoricalValidation and bundles them, plus a freshly
// computed IntelligenceScore, into one canonical, VERIFIED
// IntelligenceEnvelope - the object a future AI presenter (D2.5.5 §17-20)
// is allowed to read from. This service never calls a provider, never
// calls Gemini/Claude/OpenAI, and never invents a value for a field it
// wasn't given - every optional field on IntelligenceEnvelope stays
// optional here for exactly the same reason it's optional on the type.
import type { MarketState } from "@/types/intelligence-market-state";
import type { Regime } from "@/types/intelligence-regime";
import type { Hypothesis } from "@/types/intelligence-hypothesis";
import type { EvidenceBundle } from "@/types/evidence";
import type { RiskProfile } from "@/types/risk-intelligence";
import type { ConfidenceProfile } from "@/types/confidence-intelligence";
import type { HistoricalValidation } from "@/types/intelligence-historical-validation";
import type { IntelligenceEnvelope } from "@/types/intelligence-envelope";
import { MARKET_INTELLIGENCE_PIPELINE_VERSION } from "@/services/ai/market-intelligence-pipeline.service";
import { INTELLIGENCE_ENGINE_VERSION } from "@/services/intelligence/market-state/market-state.service";
import { IntelligenceScoreService } from "@/services/intelligence/score/intelligence-score.service";

export interface BuildIntelligenceEnvelopeInput {
  marketState: MarketState;
  regime: Regime;
  /** `[]` is valid and expected for 3 of 10 regime types - never fabricated to avoid an empty array. */
  hypotheses: Hypothesis[];
  evidence?: EvidenceBundle;
  risk?: RiskProfile;
  confidence?: ConfidenceProfile;
  /**
   * Only meaningful when `hypotheses.length === 1` (see
   * types/intelligence-envelope.ts's field comment). Passing this
   * alongside zero or multiple hypotheses is the caller's responsibility
   * to avoid - this service does not attempt to guess which hypothesis
   * it belongs to.
   */
  historicalValidation?: HistoricalValidation;
  /** Caller-supplied for determinism - never Date.now() internally. */
  generatedAt: string;
}

export class IntelligenceEnvelopeService {
  private readonly scoreService: IntelligenceScoreService;

  constructor(deps?: { scoreService?: IntelligenceScoreService }) {
    this.scoreService = deps?.scoreService ?? new IntelligenceScoreService();
  }

  build(input: BuildIntelligenceEnvelopeInput): IntelligenceEnvelope {
    const intelligenceScore = this.scoreService.compute({
      symbol: input.marketState.symbol,
      timeframe: input.marketState.timeframe,
      marketState: input.marketState,
      regime: input.regime,
      hypotheses: input.hypotheses,
      evidence: input.evidence,
      riskProfile: input.risk,
      historicalValidation: input.historicalValidation,
      generatedAt: input.generatedAt,
    });

    return {
      symbol: input.marketState.symbol,
      timeframe: input.marketState.timeframe,
      marketState: input.marketState,
      regime: input.regime,
      hypotheses: input.hypotheses,
      evidence: input.evidence,
      conflicts: input.evidence?.conflicts,
      risk: input.risk,
      confidence: input.confidence,
      historicalValidation: input.hypotheses.length === 1 ? input.historicalValidation : undefined,
      intelligenceScore,
      generatedAt: input.generatedAt,
      pipelineVersion: MARKET_INTELLIGENCE_PIPELINE_VERSION,
      intelligenceEngineVersion: INTELLIGENCE_ENGINE_VERSION,
    };
  }
}
