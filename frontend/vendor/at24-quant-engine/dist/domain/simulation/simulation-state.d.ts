import type { Account } from "./account.js";
import type { Position } from "../position.js";
import type { SimulationOrder } from "./order.js";
import type { SimulationTrade } from "./trade.js";
/**
 * Immutable snapshot (Q0.5.28) — every processing step produces a NEW
 * SimulationState, never mutates this one. Scoped to a single instrument
 * (Q0.5 is explicitly not a portfolio engine), so `openPositions` holds
 * at most one entry under NETTING mode (Q0.5.19).
 *
 * Q0.12 CONTRACT CHANGE (additive, backward-compatible): added
 * `orderCreationBarIndex`, mirroring `entryBarIndexByPosition`'s own
 * established pattern — needed to evaluate a `BAR`-kind
 * `OrderExpirationPolicy` (bars elapsed since the order's OWN creation
 * bar, never inferred from a timestamp difference since bar durations
 * are not assumed uniform).
 */
export interface SimulationState {
    readonly clock: number;
    readonly account: Account;
    readonly openPositions: ReadonlyMap<string, Position>;
    readonly pendingOrders: ReadonlyMap<string, SimulationOrder>;
    readonly ledger: readonly SimulationTrade[];
    readonly entryBarIndexByPosition: ReadonlyMap<string, number>;
    readonly partialCloseTriggered: ReadonlySet<string>;
    readonly tradingDayKey: string;
    readonly realizedPnlToday: number;
    readonly equityAtDayStart: number;
    readonly orderCreationBarIndex: ReadonlyMap<string, number>;
}
