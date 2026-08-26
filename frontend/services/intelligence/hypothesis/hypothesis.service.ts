// services/intelligence/hypothesis/hypothesis.service.ts
// Sprint D2.5.3 - Deterministic Hypothesis Engine. Pure, synchronous,
// I/O-free (exactly like MarketStateService/RegimeService before it): no
// Gemini, no LLM, no random values, no external AI model, no hidden
// scoring model, no current-time-dependent classification logic. For
// identical (MarketState, Regime, EvidenceBundle) input, generate()
// always returns an identical Hypothesis[] - including `id`, which is
// derived deterministically from the input rather than randomly
// generated (see buildId below).
//
// ONE hypothesis per regimeType, at most (a deliberately small, closed
// mapping - Regime's own precedence already picked the single most
// informative classification, so this service doesn't independently
// re-derive competing hypotheses from raw structure fields):
//   trending-bullish  -> trend-continuation-bullish
//   trending-bearish  -> trend-continuation-bearish
//   breakout          -> breakout-confirmation-bullish
//   breakdown         -> breakout-confirmation-bearish
//   ranging           -> range-continuation   (only if real range evidence exists)
//   high-volatility   -> volatility-expansion
//   low-volatility    -> volatility-contraction
//   insufficient-data -> [] (never a directional hypothesis from incomplete input)
//   transition        -> [] (see below)
//   low-liquidity     -> [] (Regime never actually emits this - defensive only)
//
// reversal-candidate-bullish/bearish are declared in the type but NEVER
// generated in D2.5.3. The only structurally-available reversal signal is
// Regime's own "transition" classification, but Regime (types/
// intelligence-regime.ts) exposes the fact that a transition occurred
// only inside a human-readable `basis` string, not as a separate,
// strongly-typed "new regime type" field - building a falsifiable,
// strongly-typed reversal condition on top of that would mean either
// fragile string-parsing or extending D2.5.2's Regime contract, and this
// sprint's instructions treat D2.5.1/D2.5.2 as frozen. Per the sprint's
// own instruction ("if the current MarketState does not provide enough
// evidence for a falsifiable reversal condition, leave reversal
// hypotheses unimplemented... better to have fewer valid hypotheses than
// many unreliable ones"), reversal hypotheses are left unimplemented -
// see docs/architecture/D2.5.3-hypothesis-engine-spec.md §13.
//
// `confidence`: this contract deliberately does NOT add a second,
// hypothesis-level confidence number. `regimeContext.confidence` (Regime's
// own, already-deterministic "how much underlying data was available"
// score - see D2.5.2) is reused as the hypothesis's strength/completeness
// signal. Adding a parallel score here would risk two numbers drifting
// out of sync for the same underlying evidence, and there is nothing new
// to measure: the evidence backing a hypothesis IS the regime's own
// basis. This is never a probability of profit - see the architecture
// doc §5.
import type { MarketState } from "@/types/intelligence-market-state";
import type { Regime, RegimeType } from "@/types/intelligence-regime";
import type { EvidenceBundle, EvidenceItem, EvidenceType } from "@/types/evidence";
import type {
  Hypothesis,
  HypothesisType,
  InvalidationCondition,
  PredictionWindow,
} from "@/types/intelligence-hypothesis";
import { INTELLIGENCE_ENGINE_VERSION } from "../market-state/market-state.service";

export const HYPOTHESIS_ENGINE_GENERATED_BY = "deterministic-hypothesis-engine-v2";

// Prediction windows - documented, versioned, deliberately NOT claimed to
// be statistically optimized (that's future research, per the sprint
// brief). Candle counts are chosen for a defensible, stated reason each,
// not tuned against data:
//   - Trend/range continuation: 20 candles, matching MarketStateService's
//     own BREAKOUT_LOOKBACK_BARS convention - the same "recent swing
//     window" length used to define the range these hypotheses reason
//     about in the first place.
//   - Breakout/breakdown confirmation: 5 candles - a short window, since
//     a breakout that immediately reverses within a handful of bars is
//     conventionally considered a failed breakout, not a slow-moving
//     continuation claim.
//   - Volatility expansion/contraction: 10 candles - shorter than a trend
//     window, since volatility regimes conventionally mean-revert faster
//     than directional trends.
const TREND_CONTINUATION_WINDOW_CANDLES = 20;
const BREAKOUT_CONFIRMATION_WINDOW_CANDLES = 5;
const RANGE_CONTINUATION_WINDOW_CANDLES = 20;
const VOLATILITY_WINDOW_CANDLES = 10;

export interface GenerateHypothesesInput {
  marketState: MarketState;
  regime: Regime;
  /** Real, optional EvidenceBundle (the existing 15D Evidence Engine's output) for the same symbol - used ONLY to source genuine opposingEvidence from its already-detected EvidenceConflicts. Never required; absence just means opposingEvidence stays []. */
  evidence?: EvidenceBundle;
}

// Deterministic id: derived entirely from the input, never randomly
// generated - required so that identical input truly produces identical
// output, field-for-field, including `id`.
function buildId(symbol: string, timeframe: string, type: HypothesisType, regimeGeneratedAt: string): string {
  return `${symbol}-${timeframe}-${type}-${regimeGeneratedAt}`;
}

function technicalEvidence(claim: string, symbol: string, asOf: string, magnitude?: number): EvidenceItem {
  return {
    type: "technical",
    symbol,
    claim,
    source: "services/intelligence/market-state/market-state.service.ts",
    asOf,
    retrievedAt: asOf,
    magnitude,
  };
}

function priceEvidence(claim: string, symbol: string, asOf: string, magnitude?: number): EvidenceItem {
  return {
    type: "price",
    symbol,
    claim,
    source: "services/intelligence/market-state/market-state.service.ts",
    asOf,
    retrievedAt: asOf,
    magnitude,
  };
}

/** Real conflicts from the passed EvidenceBundle for this symbol, converted to EvidenceItems - never independently interpreted from free text. Empty when no bundle was passed or it has no conflicts. */
function opposingFromConflicts(evidence: EvidenceBundle | undefined, symbol: string): EvidenceItem[] {
  if (!evidence) return [];
  return evidence.conflicts.filter((c) => c.symbol === symbol).map((c) => c.itemB);
}

// Post-completion addition (2026-08-26) - a second, independent real
// source of opposingEvidence. opposingFromConflicts() above requires TWO
// evidence items of the SAME EvidenceType from TWO DIFFERENT sources that
// genuinely disagree (see EvidenceRankingService.detectConflicts) - with
// this platform's single-market-data-provider-per-analysis pipeline, that
// condition is honestly almost never met, which is why "OPPOSING: None
// available" was the near-permanent default. This function adds a
// DIFFERENT, equally real signal that needs no second provider at all:
// RSI14 momentum disagreeing with a directional hypothesis's own claim -
// a standard, universally-recognized technical-analysis caution (RSI
// overbought against a bullish continuation claim, oversold against a
// bearish one). The 70/30 thresholds are the exact same real, standard
// convention this codebase already uses everywhere else (lib/chart-engine
// /sub-panel-renderer.ts's own RSI_OVERBOUGHT/RSI_OVERSOLD reference
// lines, services/ai/technical-context.service.ts's own "overbought
// territory"/"oversold territory" observation text) - never a fresh,
// invented threshold. Honestly [] (not a guess) when RSI isn't computable
// or sits in the neutral 30-70 range - most of the time, correctly.
const RSI_OVERBOUGHT_THRESHOLD = 70;
const RSI_OVERSOLD_THRESHOLD = 30;

function momentumDivergenceOpposingEvidence(marketState: MarketState, direction: "bullish" | "bearish"): EvidenceItem[] {
  const rsi14 = marketState.technical?.rsi14;
  if (rsi14 === undefined) return [];
  if (direction === "bullish" && rsi14 >= RSI_OVERBOUGHT_THRESHOLD) {
    return [
      technicalEvidence(
        `RSI14 (${rsi14.toFixed(2)}) is in overbought territory (>=${RSI_OVERBOUGHT_THRESHOLD}), a real momentum caution against continued bullish continuation.`,
        marketState.symbol,
        marketState.generatedAt,
        rsi14,
      ),
    ];
  }
  if (direction === "bearish" && rsi14 <= RSI_OVERSOLD_THRESHOLD) {
    return [
      technicalEvidence(
        `RSI14 (${rsi14.toFixed(2)}) is in oversold territory (<=${RSI_OVERSOLD_THRESHOLD}), a real momentum caution against continued bearish continuation.`,
        marketState.symbol,
        marketState.generatedAt,
        rsi14,
      ),
    ];
  }
  return [];
}

function requiredEvidenceFor(type: HypothesisType): EvidenceType[] {
  switch (type) {
    case "trend-continuation-bullish":
    case "trend-continuation-bearish":
    case "volatility-expansion":
    case "volatility-contraction":
      return ["technical"];
    case "breakout-confirmation-bullish":
    case "breakout-confirmation-bearish":
    case "range-continuation":
      return ["price", "technical"];
    default:
      return ["technical"];
  }
}

function buildHypothesis(params: {
  marketState: MarketState;
  regime: Regime;
  type: HypothesisType;
  claim: string;
  predictionWindow: PredictionWindow;
  invalidationCondition: InvalidationCondition;
  supportingEvidence: EvidenceItem[];
  opposingEvidence: EvidenceItem[];
}): Hypothesis {
  const { marketState, regime, type } = params;
  return {
    id: buildId(marketState.symbol, marketState.timeframe, type, regime.generatedAt),
    symbol: marketState.symbol,
    timeframe: marketState.timeframe,
    regimeContext: { regimeType: regime.regimeType, confidence: regime.confidence, generatedAt: regime.generatedAt },
    type,
    statement: {
      claim: params.claim,
      predictionWindow: params.predictionWindow,
      invalidationCondition: params.invalidationCondition,
    },
    requiredEvidence: requiredEvidenceFor(type),
    supportingEvidence: params.supportingEvidence,
    opposingEvidence: params.opposingEvidence,
    status: "active",
    generatedBy: HYPOTHESIS_ENGINE_GENERATED_BY,
    generatedAt: new Date().toISOString(),
    pipelineVersion: INTELLIGENCE_ENGINE_VERSION,
  };
}

function generateTrendContinuation(input: Required<Pick<GenerateHypothesesInput, "marketState" | "regime">> & { evidence?: EvidenceBundle }, direction: "bullish" | "bearish"): Hypothesis | undefined {
  const { marketState, regime, evidence } = input;
  const trend = marketState.structure?.trend;
  if (!trend?.direction) return undefined;
  const wantDirection = direction === "bullish" ? "up" : "down";
  if (trend.direction !== wantDirection) return undefined;

  const supportingEvidence = trend.basis.map((b) => technicalEvidence(b, marketState.symbol, marketState.generatedAt));
  return buildHypothesis({
    marketState,
    regime,
    type: direction === "bullish" ? "trend-continuation-bullish" : "trend-continuation-bearish",
    claim: `Current evidence is consistent with ${direction} trend continuation over the defined prediction window, invalidated if the specified structure condition fails.`,
    predictionWindow: { candles: TREND_CONTINUATION_WINDOW_CANDLES, timeframe: marketState.timeframe },
    invalidationCondition: {
      description: `Invalidated if ${direction === "bullish" ? "bullish" : "bearish"} trend structure fails (structure.trend.direction is no longer "${wantDirection}").`,
      field: "structure.trend.direction",
      comparator: "not-equals",
      referenceValue: wantDirection,
    },
    supportingEvidence,
    opposingEvidence: [...opposingFromConflicts(evidence, marketState.symbol), ...momentumDivergenceOpposingEvidence(marketState, direction)],
  });
}

function generateBreakoutConfirmation(input: Required<Pick<GenerateHypothesesInput, "marketState" | "regime">> & { evidence?: EvidenceBundle }, direction: "bullish" | "bearish"): Hypothesis | undefined {
  const { marketState, regime, evidence } = input;
  const structure = marketState.structure;
  const wantRegime: RegimeType = direction === "bullish" ? "breakout" : "breakdown";
  if (regime.regimeType !== wantRegime) return undefined;
  if (!structure?.recentRange) return undefined; // defensive - Regime's own rule already requires this

  const boundary = direction === "bullish" ? structure.recentRange.high : structure.recentRange.low;
  const supportingEvidence: EvidenceItem[] = [
    priceEvidence(
      `Latest price (${marketState.snapshot.price}) ${direction === "bullish" ? "exceeded" : "fell below"} the ${structure.recentRange.lookbackBars}-bar recent ${direction === "bullish" ? "high" : "low"} (${boundary}).`,
      marketState.symbol,
      marketState.generatedAt,
      marketState.snapshot.price,
    ),
  ];

  return buildHypothesis({
    marketState,
    regime,
    type: direction === "bullish" ? "breakout-confirmation-bullish" : "breakout-confirmation-bearish",
    claim: `Current evidence is consistent with a ${direction} ${direction === "bullish" ? "breakout" : "breakdown"} confirmation over the defined confirmation window, invalidated if price returns across the ${direction === "bullish" ? "breakout" : "breakdown"} boundary.`,
    predictionWindow: { candles: BREAKOUT_CONFIRMATION_WINDOW_CANDLES, timeframe: marketState.timeframe },
    invalidationCondition: {
      description:
        direction === "bullish"
          ? `Invalidated if price returns below the breakout boundary (${boundary}) within the confirmation window.`
          : `Invalidated if price returns above the breakdown boundary (${boundary}) within the confirmation window.`,
      field: "snapshot.price",
      comparator: direction === "bullish" ? "crosses-below" : "crosses-above",
      referenceValue: boundary,
    },
    supportingEvidence,
    opposingEvidence: [...opposingFromConflicts(evidence, marketState.symbol), ...momentumDivergenceOpposingEvidence(marketState, direction)],
  });
}

function generateRangeContinuation(input: Required<Pick<GenerateHypothesesInput, "marketState" | "regime">> & { evidence?: EvidenceBundle }): Hypothesis | undefined {
  const { marketState, regime, evidence } = input;
  if (regime.regimeType !== "ranging") return undefined;
  const recentRange = marketState.structure?.recentRange;
  if (!recentRange) return undefined; // no real range evidence - never fabricate one

  const supportingEvidence: EvidenceItem[] = [
    priceEvidence(
      `Price has stayed within the ${recentRange.lookbackBars}-bar range (${recentRange.low} - ${recentRange.high}) with no breakout or breakdown.`,
      marketState.symbol,
      marketState.generatedAt,
    ),
  ];

  return buildHypothesis({
    marketState,
    regime,
    type: "range-continuation",
    claim: "Current evidence is consistent with range continuation over the defined prediction window, invalidated if the range boundary is broken.",
    predictionWindow: { candles: RANGE_CONTINUATION_WINDOW_CANDLES, timeframe: marketState.timeframe },
    invalidationCondition: {
      description: "Invalidated once a real breakout or breakdown occurs (structure.breakoutSignal becomes defined).",
      field: "structure.breakoutSignal",
      comparator: "not-equals",
      referenceValue: "undefined",
    },
    supportingEvidence,
    opposingEvidence: opposingFromConflicts(evidence, marketState.symbol),
  });
}

function generateVolatility(input: Required<Pick<GenerateHypothesesInput, "marketState" | "regime">> & { evidence?: EvidenceBundle }, kind: "expansion" | "contraction"): Hypothesis | undefined {
  const { marketState, regime, evidence } = input;
  const wantRegime: RegimeType = kind === "expansion" ? "high-volatility" : "low-volatility";
  if (regime.regimeType !== wantRegime) return undefined;
  const band = marketState.structure?.volatilityBand;
  const atrPercent = marketState.structure?.atrPercent;
  if (!band || atrPercent === undefined) return undefined; // defensive - Regime's own rule already requires this

  const supportingEvidence: EvidenceItem[] = [
    technicalEvidence(`ATR is ${atrPercent.toFixed(2)}% of price, classified as "${band}" volatility.`, marketState.symbol, marketState.generatedAt, atrPercent),
  ];

  return buildHypothesis({
    marketState,
    regime,
    type: kind === "expansion" ? "volatility-expansion" : "volatility-contraction",
    claim: `Current evidence is consistent with volatility ${kind} continuing over the defined prediction window, invalidated if the volatility band reverts.`,
    predictionWindow: { candles: VOLATILITY_WINDOW_CANDLES, timeframe: marketState.timeframe },
    invalidationCondition: {
      description: `Invalidated if structure.volatilityBand is no longer "${band}".`,
      field: "structure.volatilityBand",
      comparator: "not-equals",
      referenceValue: band,
    },
    supportingEvidence,
    opposingEvidence: opposingFromConflicts(evidence, marketState.symbol),
  });
}

export class HypothesisService {
  generate(input: GenerateHypothesesInput): Hypothesis[] {
    const { marketState, regime, evidence } = input;
    const ctx = { marketState, regime, evidence };

    switch (regime.regimeType) {
      case "trending-bullish": {
        const h = generateTrendContinuation(ctx, "bullish");
        return h ? [h] : [];
      }
      case "trending-bearish": {
        const h = generateTrendContinuation(ctx, "bearish");
        return h ? [h] : [];
      }
      case "breakout": {
        const h = generateBreakoutConfirmation(ctx, "bullish");
        return h ? [h] : [];
      }
      case "breakdown": {
        const h = generateBreakoutConfirmation(ctx, "bearish");
        return h ? [h] : [];
      }
      case "ranging": {
        const h = generateRangeContinuation(ctx);
        return h ? [h] : [];
      }
      case "high-volatility": {
        const h = generateVolatility(ctx, "expansion");
        return h ? [h] : [];
      }
      case "low-volatility": {
        const h = generateVolatility(ctx, "contraction");
        return h ? [h] : [];
      }
      // insufficient-data, transition, low-liquidity: no directional
      // hypothesis is ever generated - see file header.
      default:
        return [];
    }
  }
}
