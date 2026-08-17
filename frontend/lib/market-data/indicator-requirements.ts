// lib/market-data/indicator-requirements.ts
// Sprint D2.8.15 - Intelligence Data Sufficiency, Evidence-State
// Reconciliation & Production Intelligence Remediation, Phase 2.
//
// A deterministic, documented model of exactly how many real candles each
// technical indicator genuinely needs before it can honestly compute a
// value - reused for reporting/auditing (scripts/validate-intelligence-
// data-sufficiency.ts, the D2.8.15 spec doc's per-instrument table), NEVER
// for silently lowering a real mathematical requirement. Every number here
// is read directly off lib/market-data/indicators.ts's own real guard
// clauses (`if (values.length < period) return undefined`, etc.) - this
// file documents them in one place, it does not invent or restate them
// differently. If indicators.ts's own guard ever changes, this file's
// numbers must be updated to match - a mismatch is a bug in this file,
// never license to change the real computation.
import {
  RSI_PERIOD_DEFAULT,
  ATR_PERIOD_DEFAULT,
  BOLLINGER_PERIOD_DEFAULT,
  MACD_FAST_DEFAULT,
  MACD_SLOW_DEFAULT,
  MACD_SIGNAL_DEFAULT,
} from "./indicators";

/**
 * EMA20/EMA50 periods are duplicated here as literals, not imported from
 * services/intelligence/market-state/market-state.service.ts (which
 * exports EMA_FAST_PERIOD/EMA_SLOW_PERIOD with the same values) - that
 * service is the DECISION-LAYER consumer of these numbers, not their
 * source of truth, and this lib/ module must not depend upward into
 * services/intelligence/ (the exact inversion RECENT_RANGE_LOOKBACK_BARS
 * below also avoids). Keep both pairs of literals in sync by inspection -
 * both are documented "never tuned" constants that change only via an
 * explicit, reviewed decision, never silently.
 */
const EMA_FAST_PERIOD_DEFAULT = 20;
const EMA_SLOW_PERIOD_DEFAULT = 50;

export const INDICATOR_REQUIREMENTS_MODEL_VERSION = "1.0.0";

export type CoreIndicatorName = "ema20" | "ema50" | "rsi14" | "atr14" | "macd" | "bollinger" | "recentRange";

export interface IndicatorRequirement {
  /** The exact minimum candle count below which this indicator's own real computation in lib/market-data/indicators.ts returns undefined - never an approximation. */
  minimumCandles: number;
  /**
   * A conventional warm-up margin ABOVE the bare minimum - at the bare
   * minimum, an EMA/RSI/ATR's very first computable value is heavily
   * weighted by its seed window and has not yet "settled" into a
   * representative reading. This is documentation/reporting guidance only
   * (e.g. flagging a PARTIAL/marginal state) - it is never enforced as a
   * hard gate; the real, hard requirement is `minimumCandles` alone,
   * matching indicators.ts's own actual behavior exactly.
   */
  preferredWarmupCandles: number;
  formula: string;
}

/**
 * `BREAKOUT_LOOKBACK_BARS` (market-state.service.ts) is duplicated here as
 * a literal, not imported, because market-state.service.ts is the
 * DECISION-LAYER consumer of this exact number, not its source of truth -
 * importing it back from there would invert the dependency direction this
 * lib/ module is meant to sit below. Keep the two literals in sync by
 * inspection (both are 20, both documented "never tuned").
 */
const RECENT_RANGE_LOOKBACK_BARS = 20;

export const INDICATOR_REQUIREMENTS: Record<CoreIndicatorName, IndicatorRequirement> = {
  ema20: {
    minimumCandles: EMA_FAST_PERIOD_DEFAULT,
    preferredWarmupCandles: EMA_FAST_PERIOD_DEFAULT * 2,
    formula: `EMA(period=${EMA_FAST_PERIOD_DEFAULT}), seeded from the first ${EMA_FAST_PERIOD_DEFAULT}-candle SMA - requires at least ${EMA_FAST_PERIOD_DEFAULT} closes.`,
  },
  ema50: {
    minimumCandles: EMA_SLOW_PERIOD_DEFAULT,
    preferredWarmupCandles: EMA_SLOW_PERIOD_DEFAULT * 2,
    formula: `EMA(period=${EMA_SLOW_PERIOD_DEFAULT}), seeded from the first ${EMA_SLOW_PERIOD_DEFAULT}-candle SMA - requires at least ${EMA_SLOW_PERIOD_DEFAULT} closes.`,
  },
  rsi14: {
    minimumCandles: RSI_PERIOD_DEFAULT + 1,
    preferredWarmupCandles: (RSI_PERIOD_DEFAULT + 1) * 2,
    formula: `Wilder's RSI(period=${RSI_PERIOD_DEFAULT}) - requires at least ${RSI_PERIOD_DEFAULT + 1} closes (period gain/loss deltas + 1).`,
  },
  atr14: {
    minimumCandles: ATR_PERIOD_DEFAULT + 1,
    preferredWarmupCandles: (ATR_PERIOD_DEFAULT + 1) * 2,
    formula: `Wilder's ATR(period=${ATR_PERIOD_DEFAULT}) - requires at least ${ATR_PERIOD_DEFAULT + 1} candles (period true-range values + 1).`,
  },
  macd: {
    // emaSeries(values, slow) needs values.length >= slow; the resulting
    // macdLine has (values.length - slow + 1) points, and
    // emaSeries(macdLine, signalPeriod) then needs macdLine.length >=
    // signalPeriod - i.e. values.length >= slow + signalPeriod - 1.
    minimumCandles: MACD_SLOW_DEFAULT + MACD_SIGNAL_DEFAULT - 1,
    preferredWarmupCandles: (MACD_SLOW_DEFAULT + MACD_SIGNAL_DEFAULT - 1) * 2,
    formula: `MACD(${MACD_FAST_DEFAULT},${MACD_SLOW_DEFAULT},${MACD_SIGNAL_DEFAULT}) - requires at least ${MACD_SLOW_DEFAULT} + ${MACD_SIGNAL_DEFAULT} - 1 = ${MACD_SLOW_DEFAULT + MACD_SIGNAL_DEFAULT - 1} closes for the signal EMA to have any input.`,
  },
  bollinger: {
    minimumCandles: BOLLINGER_PERIOD_DEFAULT,
    preferredWarmupCandles: BOLLINGER_PERIOD_DEFAULT * 2,
    formula: `SMA(period=${BOLLINGER_PERIOD_DEFAULT}) +/- k*population-stddev - requires at least ${BOLLINGER_PERIOD_DEFAULT} closes.`,
  },
  recentRange: {
    minimumCandles: RECENT_RANGE_LOOKBACK_BARS + 1,
    preferredWarmupCandles: (RECENT_RANGE_LOOKBACK_BARS + 1) * 2,
    formula: `Highest high / lowest low over the ${RECENT_RANGE_LOOKBACK_BARS} candles preceding the latest one - requires strictly more than ${RECENT_RANGE_LOOKBACK_BARS} candles total.`,
  },
};

/** The largest single minimumCandles across every tracked core indicator - the real number of candles a caller must request to have ANY chance of every core indicator being computable (never a reason to request fewer). */
export const MAX_CORE_INDICATOR_MINIMUM = Math.max(...Object.values(INDICATOR_REQUIREMENTS).map((r) => r.minimumCandles));

export interface CandleSufficiencyReport {
  requestedCandles: number;
  receivedCandles: number;
  /** True only when receivedCandles < requestedCandles - an honest signal the provider returned less than asked, independent of whether that's still enough for any given indicator. */
  truncated: boolean;
  perIndicator: Record<CoreIndicatorName, { required: number; sufficient: boolean; preferred: boolean }>;
}

/**
 * Pure, deterministic reporting function - computes NOTHING about the
 * actual indicator values (that remains lib/market-data/indicators.ts's
 * exclusive job), only whether `receivedCandles` clears each real
 * requirement above. Used by the D2.8.15 validation script and the
 * per-instrument production verification, never by MarketStateService
 * itself (which continues to call the real indicator functions directly
 * and let their own guard clauses decide, so this reporting model can
 * never silently diverge from the real computation's own behavior).
 */
export function buildCandleSufficiencyReport(requestedCandles: number, receivedCandles: number): CandleSufficiencyReport {
  const perIndicator = {} as CandleSufficiencyReport["perIndicator"];
  for (const [name, req] of Object.entries(INDICATOR_REQUIREMENTS) as [CoreIndicatorName, IndicatorRequirement][]) {
    perIndicator[name] = {
      required: req.minimumCandles,
      sufficient: receivedCandles >= req.minimumCandles,
      preferred: receivedCandles >= req.preferredWarmupCandles,
    };
  }
  return {
    requestedCandles,
    receivedCandles,
    truncated: receivedCandles < requestedCandles,
    perIndicator,
  };
}
