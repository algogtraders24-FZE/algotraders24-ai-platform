import type { Instrument } from "../../domain/market-data.js";
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
