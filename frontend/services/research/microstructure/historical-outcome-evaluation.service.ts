// services/research/microstructure/historical-outcome-evaluation.service.ts
// Sprint D2.8.14 - Historical Microstructure Outcome Validation. RESEARCH
// ONLY. Computes real forward-return/MFE/MAE metrics at fixed candle
// horizons (+1/+3/+5/+10) using ONLY real historical candles strictly
// AFTER each observation's own `observedAt` - the microstructure evidence
// itself (built by historical-microstructure-dataset.service.ts) never
// sees this data; this file is deliberately the ONLY place forward
// (post-observation) information enters the research pipeline, mirroring
// hypothesis-outcome-evaluator.service.ts's (D2.5.4) own "creation-time
// features, evaluation-time outcomes, never mixed" discipline.
//
// Reuses the existing, unmodified TimeSeriesProvider interface and
// PROVIDER_INTERVAL mapping (D2.5.4/D2.6.5) - no second candle-fetching
// implementation. Inherits that same infrastructure's own documented
// constraint: the provider returns the latest N candles AS OF NOW, not an
// arbitrary historical range - a window that falls outside what's
// currently retrievable is honestly reported as unavailable, never
// fabricated.
import type { TimeSeriesProvider } from "@/types/market-data-provider";
import type { Candle } from "@/types/market-candle";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { OUTCOME_NEUTRAL_BAND_PCT } from "@/types/research/historical-microstructure-research";
import type {
  HistoricalMicrostructureObservation,
  ForwardOutcomeMetrics,
  ForwardOutcomeUnavailableReason,
} from "@/types/research/historical-microstructure-research";

/** Deterministic, documented, fixed BEFORE any outcome is computed (Phase 4's own minimum requirement) - never derived from this run's own results. */
export const FORWARD_WINDOWS_CANDLES = [1, 3, 5, 10] as const;

const CANDLE_FETCH_BUFFER = 30;

export interface ObservationOutcomes {
  outcomes: Partial<Record<number, ForwardOutcomeMetrics>>;
  unavailableReasons: Partial<Record<number, ForwardOutcomeUnavailableReason>>;
}

export class HistoricalOutcomeEvaluationService {
  constructor(private readonly timeSeriesProvider: TimeSeriesProvider) {}

  async evaluateObservation(observation: HistoricalMicrostructureObservation): Promise<ObservationOutcomes> {
    const outcomes: Partial<Record<number, ForwardOutcomeMetrics>> = {};
    const unavailableReasons: Partial<Record<number, ForwardOutcomeUnavailableReason>> = {};

    // A non-directional hypothesis has no BUY/SELL sense to measure a
    // "favorable"/"adverse" excursion against - honestly reported as
    // unavailable for every window, never a fabricated direction.
    if (observation.hypothesisDirection === "neutral") {
      for (const w of FORWARD_WINDOWS_CANDLES) unavailableReasons[w] = "non-directional-hypothesis-no-directional-outcome";
      return { outcomes, unavailableReasons };
    }

    const maxWindow = Math.max(...FORWARD_WINDOWS_CANDLES);
    let candles: Candle[];
    try {
      candles = await this.timeSeriesProvider.getTimeSeries({
        symbol: observation.symbol,
        interval: PROVIDER_INTERVAL[observation.timeframe],
        outputSize: maxWindow + CANDLE_FETCH_BUFFER,
      });
    } catch {
      for (const w of FORWARD_WINDOWS_CANDLES) unavailableReasons[w] = "provider-unavailable";
      return { outcomes, unavailableReasons };
    }
    if (candles.length === 0) {
      for (const w of FORWARD_WINDOWS_CANDLES) unavailableReasons[w] = "provider-unavailable";
      return { outcomes, unavailableReasons };
    }

    const observedMs = new Date(observation.observedAt).getTime();
    const startIdx = candles.findIndex((c) => new Date(c.datetime).getTime() >= observedMs);
    if (startIdx === -1) {
      for (const w of FORWARD_WINDOWS_CANDLES) unavailableReasons[w] = "window-not-covered-by-available-candles";
      return { outcomes, unavailableReasons };
    }

    const direction = observation.hypothesisDirection; // "bullish" | "bearish" (neutral already returned above)
    for (const w of FORWARD_WINDOWS_CANDLES) {
      const evalIdx = startIdx + w;
      if (evalIdx >= candles.length) {
        unavailableReasons[w] = "window-not-covered-by-available-candles";
        continue;
      }
      const windowCandles = candles.slice(startIdx, evalIdx + 1);
      const evalCandle = candles[evalIdx];
      const forwardReturnPct = ((evalCandle.close - observation.creationPrice) / observation.creationPrice) * 100;

      let mfe = 0;
      let mae = 0;
      for (const c of windowCandles) {
        if (direction === "bullish") {
          mfe = Math.max(mfe, ((c.high - observation.creationPrice) / observation.creationPrice) * 100);
          mae = Math.max(mae, ((observation.creationPrice - c.low) / observation.creationPrice) * 100);
        } else {
          mfe = Math.max(mfe, ((observation.creationPrice - c.low) / observation.creationPrice) * 100);
          mae = Math.max(mae, ((c.high - observation.creationPrice) / observation.creationPrice) * 100);
        }
      }

      // Direction-adjusted so "positive" always means "the hypothesis's
      // own direction was correct", for both BUY and SELL hypotheses (§5's
      // own explicit "reverse the directional interpretation for SELL").
      const signedReturn = direction === "bullish" ? forwardReturnPct : -forwardReturnPct;
      const directionalOutcome = signedReturn > OUTCOME_NEUTRAL_BAND_PCT ? "positive" : signedReturn < -OUTCOME_NEUTRAL_BAND_PCT ? "negative" : "inconclusive";

      outcomes[w] = {
        windowCandles: w,
        evaluationTimestamp: evalCandle.datetime,
        evaluationPrice: evalCandle.close,
        forwardReturnPct,
        maximumFavorableExcursionPct: mfe,
        maximumAdverseExcursionPct: mae,
        directionalOutcome,
      };
    }

    return { outcomes, unavailableReasons };
  }
}
