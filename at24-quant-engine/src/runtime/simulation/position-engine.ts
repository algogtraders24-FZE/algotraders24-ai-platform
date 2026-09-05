import type { Instrument, OHLCVBar } from "../../domain/market-data.js";
import type { OrderSide } from "../../domain/order-intent.js";
import type { Position } from "../../domain/position.js";

/**
 * Pure functions only — every operation returns a NEW Position, never
 * mutates the input (Q0.5.18/38). NETTING mode only (Q0.5.19; see
 * docs/Q0.5_POSITION_ACCOUNT.md for the rationale) — the caller
 * (position-accounting.ts / the orchestrator) is responsible for
 * deciding whether an opposite-direction order reduces/closes the
 * existing position first, per netting semantics; this module just
 * implements the individual open/increase/reduce/close primitives.
 * All realized P&L returned here is GROSS (before fees) — fees are
 * tracked and netted out separately (see account-engine.ts / Trade),
 * matching the gross/fees/net split Q0.5.23's Trade Ledger requires.
 */

export interface OpenPositionInput {
  readonly id: string;
  readonly originatingOrderIntentId: string;
  readonly instrument: Instrument;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly entryTimestamp: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly fee: number;
}

export function openPosition(input: OpenPositionInput): Position {
  if (!(input.quantity > 0)) throw new Error(`openPosition: quantity must be > 0, got ${input.quantity}`);
  return {
    id: input.id,
    originatingOrderIntentId: input.originatingOrderIntentId,
    instrument: input.instrument,
    side: input.side,
    quantity: input.quantity,
    entryPrice: input.entryPrice,
    entryTimestamp: input.entryTimestamp,
    ...(input.stopLoss !== undefined ? { stopLoss: input.stopLoss, initialStopLoss: input.stopLoss } : {}),
    ...(input.takeProfit !== undefined ? { takeProfit: input.takeProfit } : {}),
    status: "OPEN",
    fees: input.fee,
    lastModifiedTimestamp: input.entryTimestamp,
    // P4.6 — the entry price/moment itself is the first observation; the
    // REST of the entry bar's own range is folded in separately by
    // updateExcursion() (called right after this, in simulation-engine.ts,
    // for the same bar) — mirroring resolveProtectiveExit()'s own
    // established "entry happens at that bar's open and the rest of the
    // bar's range still applies" precedent (bar-fill-model.ts). A brand
    // NEW position (including a reversal leg opened mid-bar) always
    // starts its OWN fresh excursion here — never inherits a prior
    // position's history.
    highestPriceSinceEntry: input.entryPrice,
    highestPriceSinceEntryTimestamp: input.entryTimestamp,
    lowestPriceSinceEntry: input.entryPrice,
    lowestPriceSinceEntryTimestamp: input.entryTimestamp,
  };
}

/** Scale-in: adds quantity at a new price, recomputing the volume-weighted average entry price. */
export function increasePosition(position: Position, addQuantity: number, addPrice: number, timestamp: number, fee: number): Position {
  if (position.status !== "OPEN") throw new Error(`increasePosition: position ${position.id} is not OPEN`);
  if (!(addQuantity > 0)) throw new Error(`increasePosition: addQuantity must be > 0, got ${addQuantity}`);
  const totalQuantity = position.quantity + addQuantity;
  const newAvgPrice = (position.entryPrice * position.quantity + addPrice * addQuantity) / totalQuantity;
  return {
    ...position,
    quantity: totalQuantity,
    entryPrice: newAvgPrice,
    fees: (position.fees ?? 0) + fee,
    lastModifiedTimestamp: timestamp,
  };
}

export interface ReduceOutcome {
  readonly position: Position;
  readonly grossPnl: number;
}

/** Scale-out / partial close. Validates 0 < reduceQuantity <= current quantity (Q0.5.20). */
export function reducePosition(position: Position, reduceQuantity: number, exitPrice: number, timestamp: number, fee: number): ReduceOutcome {
  if (position.status !== "OPEN") throw new Error(`reducePosition: position ${position.id} is not OPEN`);
  if (!(reduceQuantity > 0)) throw new Error(`reducePosition: reduceQuantity must be > 0, got ${reduceQuantity}`);
  if (reduceQuantity > position.quantity) {
    throw new Error(`reducePosition: reduceQuantity (${reduceQuantity}) exceeds position quantity (${position.quantity})`);
  }
  const direction = position.side === "BUY" ? 1 : -1;
  const grossPnl = direction * (exitPrice - position.entryPrice) * reduceQuantity;
  const remaining = position.quantity - reduceQuantity;
  const accumulatedFees = (position.fees ?? 0) + fee;
  const accumulatedRealized = (position.realizedPnl ?? 0) + grossPnl;

  if (remaining === 0) {
    return {
      position: {
        ...position,
        quantity: 0,
        status: "CLOSED",
        exitPrice,
        exitTimestamp: timestamp,
        realizedPnl: accumulatedRealized,
        fees: accumulatedFees,
        lastModifiedTimestamp: timestamp,
      },
      grossPnl,
    };
  }

  return {
    position: {
      ...position,
      quantity: remaining,
      realizedPnl: accumulatedRealized,
      fees: accumulatedFees,
      lastModifiedTimestamp: timestamp,
    },
    grossPnl,
  };
}

export function closePosition(position: Position, exitPrice: number, timestamp: number, fee: number): ReduceOutcome {
  return reducePosition(position, position.quantity, exitPrice, timestamp, fee);
}

export function computeUnrealizedPnl(position: Position, currentPrice: number): number {
  if (position.status !== "OPEN") return 0;
  const direction = position.side === "BUY" ? 1 : -1;
  return direction * (currentPrice - position.entryPrice) * position.quantity;
}

/**
 * P4.6 (docs/P4.6-MFE-MAE-EXCURSION-TRACKING.md) — folds ONE bar's
 * high/low into a position's running, side-agnostic price extremes.
 * Pure and strictly incremental: reads only `bar` (the CURRENT bar being
 * processed) and the position's own prior running state — never a slice
 * of `bars`, never any bar other than the one passed in. This is what
 * keeps the tracking lookahead-safe: simulation-engine.ts calls this
 * exactly once per bar, for whichever position is open at that point in
 * that bar's own processing, in the SAME strict bar-by-bar order the
 * rest of the engine already guarantees.
 *
 * Side-agnostic on purpose — this function has no notion of "favorable"
 * vs "adverse" (that depends on BUY vs SELL, applied only once, at
 * trade-build time in trade-ledger.ts). It only ever asks "is this bar's
 * high/low a new extreme," symmetrically for both directions.
 */
export function updateExcursion(position: Position, bar: OHLCVBar): Position {
  const needsHighUpdate = position.highestPriceSinceEntry === undefined || bar.high > position.highestPriceSinceEntry;
  const needsLowUpdate = position.lowestPriceSinceEntry === undefined || bar.low < position.lowestPriceSinceEntry;
  if (!needsHighUpdate && !needsLowUpdate) return position;
  return {
    ...position,
    ...(needsHighUpdate ? { highestPriceSinceEntry: bar.high, highestPriceSinceEntryTimestamp: bar.timestamp } : {}),
    ...(needsLowUpdate ? { lowestPriceSinceEntry: bar.low, lowestPriceSinceEntryTimestamp: bar.timestamp } : {}),
  };
}
