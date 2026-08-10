// services/intelligence/memory/historical-validation.service.ts
// Sprint D2.5.4 - Hypothesis Outcome & Historical Validation Engine.
// Dedicated aggregation service - reads real, already-persisted
// IntelligenceAnalysisOutcome rows (joined to their parent Run for
// symbol/timeframe ownership scoping) and computes an honest statistic.
// Never itself decides validated/invalidated/inconclusive - that's
// hypothesis-outcome-evaluator.service.ts's job; this file only counts
// what's already been recorded.
//
// Segmentation (D2.5.4 §17): never mixed across symbol, timeframe,
// regimeType, or hypothesisType - "XAUUSD M5 bullish continuation" and
// "BTCUSD H1 bullish continuation" are always two separate results, never
// combined into one rate.
//
// sampleSize/validatedRate semantics (D2.5.4 §15/§16, a deliberate,
// documented interpretation - see the architecture doc §11 for the full
// justification): `sampleSize` = validatedCount + invalidatedCount only -
// the hypotheses that were actually, objectively resolved one way or the
// other. `inconclusiveCount` is reported separately for transparency but
// does NOT count toward sample size or the rate's denominator, because an
// inconclusive result carries zero evidence about whether the hypothesis
// was right - diluting the rate with it would be statistically dishonest
// in the other direction (making the platform's track record look more
// "resolved" than it really was). `validatedRate` is undefined whenever
// `sampleSize < MIN_HISTORICAL_VALIDATION_SAMPLE` - NEVER 0. 0% would mean
// "real evidence exists that this always fails"; undefined means
// "not enough real evidence exists yet" - the two must never be confused.
import { prisma } from "@/lib/prisma";
import type { HistoricalValidation, HistoricalValidationKey } from "@/types/intelligence-historical-validation";

/**
 * Conservative, explicit architecture decision (D2.5.4 §15): below this
 * many objectively-resolved (validated+invalidated) outcomes in a segment,
 * validatedRate is undefined rather than reported. 30 is a conventional
 * "small sample" statistics threshold, not empirically tuned against this
 * platform's own data (there isn't enough of it yet to tune against - that
 * would be circular). Revisit only via an explicit, documented decision,
 * never silently.
 */
export const MIN_HISTORICAL_VALIDATION_SAMPLE = 30;

export class HistoricalValidationService {
  async buildHistoricalValidation(key: HistoricalValidationKey, userId: string): Promise<HistoricalValidation> {
    const rows = await prisma.intelligenceAnalysisOutcome.findMany({
      where: {
        hypothesisType: key.hypothesisType,
        regimeType: key.regimeType,
        status: { in: ["validated", "invalidated", "inconclusive"] },
        analysisRun: {
          userId,
          symbol: key.symbol,
          timeframe: key.timeframe,
          deletedAt: null,
        },
      },
      select: { status: true },
    });

    let validatedCount = 0;
    let invalidatedCount = 0;
    let inconclusiveCount = 0;
    for (const row of rows) {
      if (row.status === "validated") validatedCount += 1;
      else if (row.status === "invalidated") invalidatedCount += 1;
      else if (row.status === "inconclusive") inconclusiveCount += 1;
    }

    const sampleSize = validatedCount + invalidatedCount;
    const validatedRate = sampleSize >= MIN_HISTORICAL_VALIDATION_SAMPLE ? validatedCount / sampleSize : undefined;

    return {
      symbol: key.symbol,
      timeframe: key.timeframe,
      regimeType: key.regimeType,
      hypothesisType: key.hypothesisType,
      sampleSize,
      validatedCount,
      invalidatedCount,
      inconclusiveCount,
      validatedRate,
      minSampleSize: MIN_HISTORICAL_VALIDATION_SAMPLE,
      generatedAt: new Date().toISOString(),
    };
  }
}
