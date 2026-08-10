// types/intelligence-historical-validation.ts
// Sprint D2.5.4 - Hypothesis Outcome & Historical Validation Engine.
//
// A honest aggregate over real, already-evaluated IntelligenceAnalysisOutcome
// rows, segmented by the four dimensions that must never be mixed together
// (D2.5.4 §17): symbol, timeframe, regimeType, hypothesisType. Built by
// services/intelligence/memory/historical-validation.service.ts.
//
// `validatedRate` semantic boundary (D2.5.4 §16, non-negotiable): this
// number means ONLY "the percentage of completed, objectively evaluated
// historical hypotheses in this exact segment that satisfied their own
// defined validation condition." It is NEVER a probability of future
// profit, a win rate, an expected return, or a guarantee. It is undefined
// (never 0) below MIN_HISTORICAL_VALIDATION_SAMPLE - see that constant's
// own doc comment for why 0 and "insufficient evidence" must never be
// conflated.
export interface HistoricalValidationKey {
  symbol: string;
  timeframe: string;
  regimeType: string;
  hypothesisType: string;
}

export interface HistoricalValidation extends HistoricalValidationKey {
  sampleSize: number;
  validatedCount: number;
  invalidatedCount: number;
  inconclusiveCount: number;
  /** undefined below MIN_HISTORICAL_VALIDATION_SAMPLE - never a fabricated 0%. */
  validatedRate?: number;
  /** The exact threshold applied when computing this result - carried on the record itself so it's never ambiguous which rule produced it. */
  minSampleSize: number;
  generatedAt: string;
}
