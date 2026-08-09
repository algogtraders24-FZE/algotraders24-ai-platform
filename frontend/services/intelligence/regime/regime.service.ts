// services/intelligence/regime/regime.service.ts
// Sprint D2.5.2 - Market State & Regime Engine. Fixed, deterministic,
// versioned rule set: NO trained model, NO LLM, NO probabilistic scoring,
// NO network call, NO current-time dependency in the classification logic
// itself (only `generatedAt`/`transitionDetectedAt` read the clock, and
// neither feeds back into which regimeType is chosen). For identical
// MarketState input, classify() always returns the same regimeType,
// confidence, and basis.
//
// PRECEDENCE (checked in this exact order; the first match wins):
//   1. insufficient-data  - gate: nothing usable was computed at all
//   2. breakout            - most specific, highest-conviction discrete event
//   3. breakdown            - symmetric to breakout
//   4. high-volatility      - a risk condition worth surfacing even over a
//                             live trend (whipsaw risk), so it's checked
//                             before trend
//   5. trending-bullish
//   6. trending-bearish
//   7. low-volatility        - checked AFTER trend: a genuine trend is more
//                             useful information than "it's just quiet"
//   8. ranging               - default fallback when data exists but no
//                             more specific condition matched
// `transition` is NOT a rung in this chain - it's an overlay applied
// AFTER the raw classification above, only when a real previousRegime was
// supplied and materially differs from the fresh result (see
// applyTransitionOverlay below). `low-liquidity` never fires - no real
// liquidity data source exists (see types/intelligence-market-state.ts).
//
// Full justification for this ordering (and why it deliberately does not
// use the sprint brief's own suggested ordering verbatim) is in
// docs/architecture/D2.5.2-market-state-regime-spec.md §6.
import type { MarketState } from "@/types/intelligence-market-state";
import type { Regime, RegimeType } from "@/types/intelligence-regime";
import { INTELLIGENCE_ENGINE_VERSION } from "../market-state/market-state.service";

export interface ClassifyRegimeInput {
  marketState: MarketState;
  /** A real, previously-computed Regime's type for the same symbol/timeframe. Never fabricated by this service - absent means "no history available", not a guess. */
  previousRegime?: RegimeType;
}

// Confidence is derived directly from MarketState.dataQuality.band - a
// simple, deterministic, testable mapping. It reflects how much of the
// underlying data was actually available to support the classification,
// not a separate, independently-tunable opinion score.
const CONFIDENCE_BY_DATA_BAND: Record<string, number> = {
  insufficient: 0,
  low: 40,
  medium: 70,
  high: 100,
};

interface RawClassification {
  regimeType: RegimeType;
  basis: string[];
}

function classifyRaw(marketState: MarketState): RawClassification {
  const structure = marketState.structure;
  const trend = structure?.trend;

  // The gate is deliberately independent of MarketState.dataQuality.band:
  // that count includes indicators (volume, MACD, Bollinger) that don't
  // themselves feed any regime rule below. What actually matters for
  // Regime is whether ANY of the three structurally-relevant signals -
  // trend direction, a recent range, or a volatility band - could be
  // computed at all. If none of them could, classifying anything (even
  // "ranging") would be forcing a regime onto data that doesn't support
  // one.
  const nothingRegimeRelevantComputed =
    trend?.direction === undefined &&
    structure?.recentRange === undefined &&
    structure?.volatilityBand === undefined;

  if (nothingRegimeRelevantComputed) {
    return {
      regimeType: "insufficient-data",
      basis: [
        `Data quality: ${marketState.dataQuality.note}`,
        "None of trend direction, recent range, or volatility band could be computed - a regime cannot be classified honestly.",
      ],
    };
  }

  if (structure?.breakoutSignal === "breakout" && structure.recentRange) {
    return {
      regimeType: "breakout",
      basis: [
        `Latest price exceeded the ${structure.recentRange.lookbackBars}-bar recent high (${structure.recentRange.high}).`,
        "Classified as a breakout, checked before trend/volatility as the most specific discrete event.",
      ],
    };
  }

  if (structure?.breakoutSignal === "breakdown" && structure.recentRange) {
    return {
      regimeType: "breakdown",
      basis: [
        `Latest price fell below the ${structure.recentRange.lookbackBars}-bar recent low (${structure.recentRange.low}).`,
        "Classified as a breakdown, checked before trend/volatility as the most specific discrete event.",
      ],
    };
  }

  if (structure?.volatilityBand === "high") {
    return {
      regimeType: "high-volatility",
      basis: [
        `ATR is ${structure.atrPercent?.toFixed(2)}% of price - at or above the 1.5% high-volatility threshold.`,
        "Checked before trend: elevated volatility is surfaced as a risk condition even when a trend is also present.",
      ],
    };
  }

  if (trend?.direction === "up") {
    return { regimeType: "trending-bullish", basis: trend.basis };
  }

  if (trend?.direction === "down") {
    return { regimeType: "trending-bearish", basis: trend.basis };
  }

  if (structure?.volatilityBand === "low") {
    return {
      regimeType: "low-volatility",
      basis: [
        `ATR is ${structure.atrPercent?.toFixed(2)}% of price - below the 0.5% low-volatility threshold.`,
        "No breakout, breakdown, or clear trend was present - low volatility is the most specific available classification.",
      ],
    };
  }

  const rangingBasis: string[] = ["No breakout, breakdown, clear trend, or volatility extreme was present."];
  if (trend?.direction === "sideways") {
    rangingBasis.push(...trend.basis);
  } else {
    rangingBasis.push("Trend direction itself could not be computed, but other data was available - defaulting to ranging rather than forcing a trend.");
  }
  return { regimeType: "ranging", basis: rangingBasis };
}

function applyTransitionOverlay(raw: RawClassification, previousRegime: RegimeType | undefined): { regimeType: RegimeType; basis: string[]; transitionDetectedAt?: string } {
  if (previousRegime === undefined) return raw;
  if (raw.regimeType === "insufficient-data") return raw; // never overlay a non-classification
  if (previousRegime === raw.regimeType) return raw; // no material change

  return {
    regimeType: "transition",
    basis: [
      `Previous regime was "${previousRegime}"; the fresh classification is "${raw.regimeType}" - a material change.`,
      ...raw.basis,
    ],
    transitionDetectedAt: new Date().toISOString(),
  };
}

export class RegimeService {
  classify(input: ClassifyRegimeInput): Regime {
    const raw = classifyRaw(input.marketState);
    const overlaid = applyTransitionOverlay(raw, input.previousRegime);
    // insufficient-data always reports 0 confidence, regardless of
    // dataQuality.band - "we could not classify this" is never paired
    // with a nonzero confidence number, even if some unrelated indicator
    // (e.g. volume) happened to be computable.
    const confidence =
      overlaid.regimeType === "insufficient-data" ? 0 : (CONFIDENCE_BY_DATA_BAND[input.marketState.dataQuality.band] ?? 0);

    return {
      symbol: input.marketState.symbol,
      timeframe: input.marketState.timeframe,
      regimeType: overlaid.regimeType,
      confidence,
      basis: overlaid.basis,
      previousRegime: input.previousRegime,
      transitionDetectedAt: "transitionDetectedAt" in overlaid ? overlaid.transitionDetectedAt : undefined,
      generatedAt: new Date().toISOString(),
      pipelineVersion: INTELLIGENCE_ENGINE_VERSION,
    };
  }
}
