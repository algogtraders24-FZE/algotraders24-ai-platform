// services/algo-test/live-execution/live-execution.service.ts
// Live Execution (Paper) - Phase 1. Owner-directed minimal scope: runs
// ONLY while the user's own browser tab stays open and keeps polling a
// fixed interval - no new cron, no new Agent Framework tool/permission,
// no server-side "is this running" row of its own. One strategy, one
// symbol, one open position at a time.
//
// Deliberately STATELESS server-side: the client re-sends the SAME
// compiledSpec (from an earlier /api/private/algo-test/compile call) on
// every tick; this function derives everything else fresh each call from
// PaperTradingService's own current account state - never a separate
// "is this strategy running" row of its own. Closing the browser tab
// genuinely stops execution; nothing keeps running unattended.
//
// Reuses, never duplicates:
//   - buildIndicatorSeriesFromCompiledIndicators (nl-strategy-compiler.
//     service.ts, the SAME calculateSeries() fold every other indicator-
//     series caller already uses) + collectStrategyIndicatorRefs
//     (../strategy-spec-indicators.ts) to recover which indicators to
//     compute from a compiledSpec alone, the same pairing quant-chat-
//     preview.service.ts's OWN sibling case (buildIndicatorSeries called
//     with real bars) already established for a same-request compile.
//   - firstMatchingEntryRule/firstMatchingExitRule (at24-quant-engine's
//     signal-generator.ts) - the same deterministic rule evaluator the
//     reference strategies use, never a second evaluator.
//   - PaperTradingService.openPosition/closePosition (unmodified) for
//     the actual paper fill - this service never touches prisma directly.
//
// Stop-loss/take-profit enforcement: at24-quant-engine's own
// RiskSpecification is SPECIFICATION-ONLY (its own doc comment: "NOT
// wired to... any evaluation logic - a future RiskAdapter is the only
// allowed bridge, and it is not built here"). This service is the FIRST
// real enforcement of StopLossRule/TakeProfitRule anywhere in this
// codebase, deliberately narrow: "fixed-distance"/"fixed-price" stops,
// "fixed-distance"/"fixed-price"/"risk-multiple" targets. "atr-multiple"
// stops and "atr-based"/"percent-equity-risk"/"fixed-lot" position sizing
// are honestly rejected (skipped, with a clear reason), never silently
// ignored or guessed - both need real per-instrument facts (an ATR value,
// a contract size) this Phase 1 has no reliable source for yet.
import { twelveDataHistoricalDataProvider } from "../historical-data/twelve-data-provider";
import { buildIndicatorSeriesFromCompiledIndicators } from "../nl-strategy-compiler.service";
import { collectStrategyIndicatorRefs } from "../strategy-spec-indicators";
import { paperTradingService } from "@/services/paper-trading/paper-trading.service";
import { firstMatchingEntryRule, firstMatchingExitRule } from "at24-quant-engine";
import type { MarketState, OHLCVBar, StopLossRule, StrategySpec, TakeProfitRule, Timeframe } from "at24-quant-engine";
import type { PaperPositionSide, PaperPositionView } from "@/types/paper-trading";

// Matches quant-chat-preview.service.ts's own identical table (a small,
// purely-declarative constant, not worth a shared module for 7 entries -
// same judgment call that file's own header comment already made about
// algo-test.service.ts's SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME).
const TIMEFRAME_DURATION_MS: Readonly<Partial<Record<Timeframe, number>>> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
};

// Matches useChartCandles.ts / quant-chat-preview.service.ts's own
// PREVIEW_BAR_COUNT precedent - enough history for any indicator this
// compiler can emit (longest period well under 300) without over-fetching.
const BAR_WINDOW = 300;

export type LiveExecutionAction = "none" | "opened" | "closed" | "skipped";

export interface LiveExecutionTickResult {
  readonly action: LiveExecutionAction;
  readonly detail: string;
  readonly position?: PaperPositionView;
  readonly evaluatedAt: string;
  readonly lastBarTime?: number;
}

export interface LiveExecutionTickInput {
  readonly userId: string;
  readonly spec: StrategySpec;
}

function computeStopPrice(entryPrice: number, side: PaperPositionSide, rule: StopLossRule): number | undefined {
  if (rule.type === "fixed-price") return rule.price;
  if (rule.type === "fixed-distance") return side === "buy" ? entryPrice - rule.distance : entryPrice + rule.distance;
  return undefined; // atr-multiple - not supported yet, honest gap (see header)
}

function computeTargetPrice(entryPrice: number, side: PaperPositionSide, rule: TakeProfitRule, stopDistance: number | undefined): number | undefined {
  if (rule.type === "fixed-price") return rule.price;
  if (rule.type === "fixed-distance") return side === "buy" ? entryPrice + rule.distance : entryPrice - rule.distance;
  if (rule.type === "risk-multiple" && stopDistance !== undefined) return side === "buy" ? entryPrice + stopDistance * rule.rMultiple : entryPrice - stopDistance * rule.rMultiple;
  return undefined; // risk-multiple with no computable stop distance - honest gap
}

export async function evaluateLiveExecutionTick(input: LiveExecutionTickInput): Promise<LiveExecutionTickResult> {
  const { userId, spec } = input;
  const evaluatedAt = new Date().toISOString();

  const symbol = spec.instruments[0]?.symbol;
  const engineTimeframe = spec.timeframes[0];
  const durationMs = engineTimeframe ? TIMEFRAME_DURATION_MS[engineTimeframe] : undefined;
  if (!symbol || !engineTimeframe || !durationMs) {
    return { action: "skipped", detail: "Strategy has no usable instrument/timeframe.", evaluatedAt };
  }

  const sizing = spec.risk.sizing;
  if (sizing.method !== "fixed-quantity") {
    return {
      action: "skipped",
      detail: `Position sizing method "${sizing.method}" is not supported for live execution yet - only fixed-quantity is. Recompile the strategy with a fixed quantity.`,
      evaluatedAt,
    };
  }

  const now = new Date();
  const startTime = new Date(now.getTime() - BAR_WINDOW * durationMs);
  let bars: readonly OHLCVBar[];
  try {
    const res = await twelveDataHistoricalDataProvider.getBars({ symbol, timeframe: engineTimeframe, startTime: startTime.toISOString(), endTime: now.toISOString() });
    bars = res.bars;
  } catch (err) {
    return { action: "skipped", detail: `Could not fetch market data: ${err instanceof Error ? err.message : String(err)}`, evaluatedAt };
  }
  if (bars.length < 2) {
    return { action: "skipped", detail: "Not enough historical bars yet.", evaluatedAt };
  }

  const indicatorRefs = collectStrategyIndicatorRefs(spec);
  const series = buildIndicatorSeriesFromCompiledIndicators(indicatorRefs)(bars);
  const lastIdx = bars.length - 1;
  const indicatorValues = new Map<string, number | boolean>();
  const previousIndicatorValues = new Map<string, number | boolean>();
  for (const [key, values] of series) {
    const cur = values[lastIdx];
    const prev = values[lastIdx - 1];
    if (cur !== undefined) indicatorValues.set(key, cur);
    if (prev !== undefined) previousIndicatorValues.set(key, prev);
  }

  // expression-evaluator.ts throws if a condition references an indicator
  // with no value for the CURRENT bar (e.g. a period-21 indicator with
  // fewer than 21 bars of real history yet - a real, expected state early
  // in a fresh strategy's life, not a bug). A missing PREVIOUS value is
  // handled gracefully by the engine itself (treated as `false` for
  // cross_above/cross_below only) and never needs guarding here. Checked
  // before calling firstMatchingEntryRule/ExitRule so a genuinely early
  // strategy degrades to an honest, actionable "skipped" tick, never an
  // unhandled 500 the client isn't prepared to recover from.
  const missing = [...series.keys()].filter((key) => !indicatorValues.has(key));
  if (missing.length > 0) {
    return { action: "skipped", detail: `Not enough bar history yet for: ${missing.join(", ")}. This resolves once more bars accumulate.`, evaluatedAt };
  }

  const lastBar = bars[lastIdx]!;
  const state: MarketState = {
    instrument: { symbol },
    timeframe: engineTimeframe,
    asOf: lastBar.timestamp,
    bars,
    indicatorValues,
    previousIndicatorValues,
  };

  const summary = await paperTradingService.getSummary(userId);
  const openPosition = summary.positions.find((p) => p.symbol === symbol && p.status === "open");

  if (openPosition) {
    const positionSide: "BUY" | "SELL" = openPosition.side === "buy" ? "BUY" : "SELL";
    const exitRule = firstMatchingExitRule(spec.exitRules, positionSide, state);
    if (exitRule) {
      const closed = await paperTradingService.closePosition(userId, openPosition.id);
      return { action: "closed", detail: `Exit rule "${exitRule.id}" fired.`, position: closed, evaluatedAt, lastBarTime: lastBar.timestamp };
    }

    if (openPosition.entryPrice !== undefined) {
      const stopRule = spec.risk.stopLoss;
      const targetRule = spec.risk.takeProfit;
      const stopPrice = stopRule ? computeStopPrice(openPosition.entryPrice, openPosition.side, stopRule) : undefined;
      const stopDistance = stopPrice !== undefined ? Math.abs(openPosition.entryPrice - stopPrice) : undefined;
      const targetPrice = targetRule ? computeTargetPrice(openPosition.entryPrice, openPosition.side, targetRule, stopDistance) : undefined;
      const currentPrice = lastBar.close;
      const hitStop = stopPrice !== undefined && (openPosition.side === "buy" ? currentPrice <= stopPrice : currentPrice >= stopPrice);
      const hitTarget = targetPrice !== undefined && (openPosition.side === "buy" ? currentPrice >= targetPrice : currentPrice <= targetPrice);
      if (hitStop || hitTarget) {
        const closed = await paperTradingService.closePosition(userId, openPosition.id);
        return {
          action: "closed",
          detail: hitStop ? `Stop-loss hit (price ${currentPrice} vs stop ${stopPrice}).` : `Take-profit hit (price ${currentPrice} vs target ${targetPrice}).`,
          position: closed,
          evaluatedAt,
          lastBarTime: lastBar.timestamp,
        };
      }
    }

    return { action: "none", detail: "Position open, no exit condition met yet.", evaluatedAt, lastBarTime: lastBar.timestamp };
  }

  const entryRule = firstMatchingEntryRule(spec.entryRules, state);
  if (!entryRule) {
    return { action: "none", detail: "No entry condition met yet.", evaluatedAt, lastBarTime: lastBar.timestamp };
  }
  const opened = await paperTradingService.openPosition(userId, {
    symbol,
    side: entryRule.direction === "BUY" ? "buy" : "sell",
    quantity: sizing.quantity,
  });
  return { action: "opened", detail: `Entry rule "${entryRule.id}" fired (${entryRule.direction}).`, position: opened, evaluatedAt, lastBarTime: lastBar.timestamp };
}
