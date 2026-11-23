import type { SimulationTrade } from "../../domain/simulation/trade.js";
import type { Position } from "../../domain/position.js";
import { tryComputeR } from "../risk/r-multiple.js";

export interface RecordTradeInput {
  readonly tradeId: string;
  readonly strategyVersion: string;
  readonly position: Position;
  readonly exitPrice: number;
  readonly exitTimestamp: number;
  readonly quantity: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly fillModel: string;
  readonly spreadModel: string;
  readonly slippageModel: string;
  readonly feeModel: string;
  /** Only set when the caller genuinely knows why this position closed (P3.3) — never invented here. */
  readonly exitReason?: string;
}

/**
 * `rMultiple` reuses Q0.3's R formula via `tryComputeR` (r-multiple.ts, the
 * same primitives as `computeRealizedR`) — no second R formula (Q0.5.24). It
 * is `null`, never 0/NaN, when the position carries no stopLoss OR when its
 * initial risk distance is not positive (R is undefined without a positive
 * risk distance; previously `computeRealizedR` threw in the second case).
 *
 * Q0.10: R-multiple is computed from `initialStopLoss` (the stop AT ENTRY,
 * never moved) when present, falling back to `stopLoss` for a position
 * that never had management applied to it (or a hand-built Position
 * predating this field). Using the CURRENT `stopLoss` here would make the
 * "risk" shrink or invert the moment breakeven/trailing moves the stop
 * past entry — exactly the outcome those features are DESIGNED to
 * produce — turning a normal winning trade into a thrown error instead of
 * a well-defined (correctly large) R-multiple. See
 * docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md.
 */
/**
 * `mfeR`/`maeR` (P4.6, docs/P4.6-MFE-MAE-EXCURSION-TRACKING.md): the
 * SAME `riskBasisStop` above, but via `tryComputeR` (null-safe — see
 * that function's own doc comment) rather than `computeRealizedR`, since
 * MFE/MAE must stay total even in the one case `rMultiple` above does
 * not defend against (a pyramided position's risk distance going
 * non-positive). `Position.highestPriceSinceEntry`/`lowestPriceSinceEntry`
 * are side-agnostic (position-engine.ts); the favorable/adverse mapping
 * is applied exactly HERE, once: for BUY, favorable=high/adverse=low;
 * for SELL, favorable=low/adverse=high — mirroring `resolveProtectiveExit`'s
 * own established side-aware convention (bar-fill-model.ts). A
 * timestamp is included if and only if its own R value is non-null —
 * never independently.
 */
function buildExcursion(position: Position, riskBasisStop: number | undefined): Pick<SimulationTrade, "mfeR" | "maeR" | "mfeTimestamp" | "maeTimestamp"> {
  const favorablePrice = position.side === "BUY" ? position.highestPriceSinceEntry : position.lowestPriceSinceEntry;
  const favorableTimestamp = position.side === "BUY" ? position.highestPriceSinceEntryTimestamp : position.lowestPriceSinceEntryTimestamp;
  const adversePrice = position.side === "BUY" ? position.lowestPriceSinceEntry : position.highestPriceSinceEntry;
  const adverseTimestamp = position.side === "BUY" ? position.lowestPriceSinceEntryTimestamp : position.highestPriceSinceEntryTimestamp;

  const mfeR = riskBasisStop !== undefined && favorablePrice !== undefined ? tryComputeR(position.side, position.entryPrice, riskBasisStop, favorablePrice) : null;
  const maeR = riskBasisStop !== undefined && adversePrice !== undefined ? tryComputeR(position.side, position.entryPrice, riskBasisStop, adversePrice) : null;

  return {
    mfeR,
    maeR,
    ...(mfeR !== null && favorableTimestamp !== undefined ? { mfeTimestamp: favorableTimestamp } : {}),
    ...(maeR !== null && adverseTimestamp !== undefined ? { maeTimestamp: adverseTimestamp } : {}),
  };
}

export function buildTrade(input: RecordTradeInput): SimulationTrade {
  const riskBasisStop = input.position.initialStopLoss ?? input.position.stopLoss;
  // R is undefined (null) when there is no stop OR when the initial risk distance is not positive: a pyramided position's volume-weighted-average
  // entry can sit past the fixed initial stop, and a gap can fill an entry beyond its own stop. That used to throw and abort the whole run
  // ("riskDistance must be > 0 ..."); the trade is now recorded with rMultiple null, exactly like a trade without a stop.
  const rMultiple =
    riskBasisStop !== undefined
      ? tryComputeR(input.position.side, input.position.entryPrice, riskBasisStop, input.exitPrice)
      : null;
  const excursion = buildExcursion(input.position, riskBasisStop);

  return {
    tradeId: input.tradeId,
    strategyVersion: input.strategyVersion,
    instrument: input.position.instrument,
    side: input.position.side,
    entryPrice: input.position.entryPrice,
    entryTimestamp: input.position.entryTimestamp,
    exitPrice: input.exitPrice,
    exitTimestamp: input.exitTimestamp,
    quantity: input.quantity,
    grossPnl: input.grossPnl,
    fees: input.fees,
    netPnl: input.grossPnl - input.fees,
    rMultiple,
    // P3.3 — copied straight through from the Position already on hand;
    // no new computation, omitted (never fabricated) when the position
    // never carried one.
    ...(input.position.stopLoss !== undefined ? { stopLoss: input.position.stopLoss } : {}),
    ...(input.position.takeProfit !== undefined ? { takeProfit: input.position.takeProfit } : {}),
    ...(input.exitReason !== undefined ? { exitReason: input.exitReason } : {}),
    executionMetadata: {
      fillModel: input.fillModel,
      spreadModel: input.spreadModel,
      slippageModel: input.slippageModel,
      feeModel: input.feeModel,
    },
    ...excursion,
  };
}

/**
 * Append-only, immutable ledger (Q0.5.23) — no update/remove method
 * exists at all. Every recorded Trade is frozen so any accidental
 * downstream mutation attempt throws rather than silently rewriting
 * history.
 */
export class TradeLedger {
  private readonly trades: SimulationTrade[] = [];

  record(trade: SimulationTrade): SimulationTrade {
    Object.freeze(trade);
    this.trades.push(trade);
    return trade;
  }

  all(): readonly SimulationTrade[] {
    return [...this.trades];
  }

  size(): number {
    return this.trades.length;
  }
}
