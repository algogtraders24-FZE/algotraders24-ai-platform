import type { Instrument, Timeframe } from "../../domain/market-data.js";
import type { SimulationOrder } from "../../domain/simulation/order.js";
import type { SpreadModel, SlippageModel } from "../../domain/reality-models.js";
import type { IntrabarSequence } from "../../domain/fidelity/intrabar-sequence.js";
import { resolveMarketFill, resolveLimitFill, resolveStopFill, resolveStopLimitFill, resolveProtectiveExit, type BarFillOutcome, type ProtectiveExitOutcome } from "../simulation/bar-fill-model.js";
import { observationToBar } from "./bar-magnifier.js";

/**
 * Q0.6.8/9 — D2/D3 order-fill resolution. This DOES NOT reimplement fill
 * rules: it walks `sequence.observations` in chronological order and
 * calls Q0.5's OWN resolveMarketFill/resolveLimitFill/resolveStopFill/
 * resolveStopLimitFill on EACH child bar, returning the first one that
 * resolves. Ambiguity that a single child bar's own OHLC cannot prove is
 * still preserved by those functions unchanged (Q0.6.7) — D2/D3 can only
 * ever be MORE precise than D1, never contradict it, because it is
 * LITERALLY the same conservative per-bar logic applied at finer
 * granularity, not a different policy.
 *
 * A STOP_LIMIT order that triggers partway through this parent's
 * children continues to be walked as a LIMIT for the REMAINING children
 * of this same parent (an improvement in precision D1 cannot offer,
 * since D1 has no sub-bar granularity to trigger mid-bar) — if still not
 * filled by the end of this parent's children, `triggeredOnly: true` is
 * returned so the caller transitions the order to TRIGGERED for
 * subsequent parents, exactly mirroring D1's cross-bar TRIGGERED
 * semantics.
 */
export function resolveIntrabarOrderFill(
  order: SimulationOrder,
  sequence: IntrabarSequence,
  instrument: Instrument,
  detailTimeframe: Timeframe,
  spreadModel: SpreadModel,
  slippageModel: SlippageModel,
): BarFillOutcome {
  let triggered = order.status === "TRIGGERED";

  for (const obs of sequence.observations) {
    const childBar = observationToBar(obs, instrument, detailTimeframe);
    let outcome: BarFillOutcome;
    if (order.orderType === "MARKET") outcome = resolveMarketFill(order, childBar, spreadModel, slippageModel);
    else if (order.orderType === "LIMIT" || triggered) outcome = resolveLimitFill(order, childBar);
    else if (order.orderType === "STOP") outcome = resolveStopFill(order, childBar);
    else outcome = resolveStopLimitFill(order, childBar);

    if (outcome.filled) {
      return { ...outcome, reason: `${outcome.reason} [D2/D3 child bar @${obs.timestamp}]` };
    }
    if (outcome.triggeredOnly) {
      triggered = true;
    }
  }

  return {
    filled: false,
    ...(triggered ? { triggeredOnly: true } : {}),
    reason:
      sequence.observations.length === 0
        ? "no child bars available for this parent interval"
        : triggered
          ? "stop triggered within this parent's children; limit not yet filled by the last available child bar"
          : "no child bar resolved a fill",
  };
}

/**
 * Q0.6.13/20/21 — D2/D3 protective SL/TP resolution: walks the child
 * sequence, calling Q0.5's OWN resolveProtectiveExit per child bar,
 * returning the FIRST one that resolves. Because it is the same
 * function, ambiguity a single child bar cannot resolve (both levels
 * reachable within that one child) is still reported as `ambiguous:
 * true` — D2/D3 narrow WHICH bar the ambiguity occurred in, never
 * fabricate certainty the data does not support.
 */
export function resolveIntrabarProtectiveExit(
  side: "BUY" | "SELL",
  stopLoss: number | undefined,
  takeProfit: number | undefined,
  sequence: IntrabarSequence,
  instrument: Instrument,
  detailTimeframe: Timeframe,
): ProtectiveExitOutcome {
  if (stopLoss === undefined && takeProfit === undefined) return { exited: false, reason: "no protective levels set" };

  for (const obs of sequence.observations) {
    const childBar = observationToBar(obs, instrument, detailTimeframe);
    const outcome = resolveProtectiveExit(side, stopLoss, takeProfit, childBar);
    if (outcome.exited) {
      return { ...outcome, reason: `${outcome.reason} [D2/D3 child bar @${obs.timestamp}]` };
    }
  }

  return { exited: false, reason: sequence.observations.length === 0 ? "no child bars available for this parent interval" : "neither level reached across the available child bars" };
}
