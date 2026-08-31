import type { Instrument } from "./market-data.js";
import type { OrderSide } from "./order-intent.js";

export type PositionStatus = "OPEN" | "CLOSED";

/**
 * Q0.5 CONTRACT CHANGE (additive, backward-compatible): added `fees` and
 * `lastModifiedTimestamp`, both optional. Q0.5's Position Engine
 * (runtime/simulation/position-engine.ts) always populates them; a
 * hypothetical caller constructing a Position by hand (as Q0's own tests
 * did) is unaffected since both remain optional. See
 * docs/Q0.5_POSITION_ACCOUNT.md.
 *
 * Q0.10 CONTRACT CHANGE (additive, backward-compatible): added
 * `initialStopLoss`, optional. `stopLoss` is the CURRENT protective stop
 * (mutated by breakeven/trailing management — used to decide when a
 * position exits); `initialStopLoss` is the stop-loss level AT THE MOMENT
 * THE POSITION OPENED and never changes afterward — the true basis for
 * R-multiple reporting. Before Q0.10, no code ever moved `stopLoss` past
 * entry, so the two values always coincided and nothing depended on the
 * distinction. `openPosition()` (runtime/simulation/position-engine.ts)
 * always populates it equal to the opening `stopLoss`; every other
 * position-engine function passes it through unchanged via `...position`
 * spreads. A hypothetical hand-built Position omitting it degrades
 * gracefully — `trade-ledger.ts`'s `buildTrade()` falls back to
 * `stopLoss` when it is absent. See docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md.
 */
export interface Position {
  readonly id: string;
  readonly originatingOrderIntentId: string;
  readonly instrument: Instrument;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly entryTimestamp: number;
  readonly stopLoss?: number;
  readonly initialStopLoss?: number;
  readonly takeProfit?: number;
  readonly status: PositionStatus;
  readonly exitPrice?: number;
  readonly exitTimestamp?: number;
  readonly realizedPnl?: number;
  readonly fees?: number;
  readonly lastModifiedTimestamp?: number;
}
