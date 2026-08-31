import type { Account } from "./account.js";
import type { Position } from "../position.js";
import type { SimulationTrade } from "./trade.js";
import type { SimulationProvenance } from "./provenance.js";
import type { CoreMetricName } from "../metrics.js";

export interface EventStatistics {
  readonly totalEvents: number;
  readonly eventsByType: Readonly<Record<string, number>>;
}

/**
 * Named `SimulationExecutionStatistics` to avoid colliding with Q0's
 * placeholder `ExecutionStatistics` already reserved by
 * `domain/backtest-result.ts` (see `trade.ts`'s equivalent note on
 * `SimulationTrade`).
 */
export interface SimulationExecutionStatistics {
  readonly ordersCreated: number;
  readonly ordersFilled: number;
  readonly ordersRejected: number;
  readonly ordersCancelled: number;
  readonly ordersExpired: number;
}

/**
 * `resultHash` is `computeCanonicalHash()` (Q0.2, reused not
 * reimplemented) over every field below EXCEPT itself — a byte-for-byte
 * fingerprint of the entire outcome, letting two runs be compared with
 * one equality check (Q0.5.36's determinism requirement).
 */
export interface SimulationResult {
  readonly finalAccount: Account;
  readonly finalPositions: readonly Position[];
  readonly tradeLedger: readonly SimulationTrade[];
  readonly eventStatistics: EventStatistics;
  readonly executionStatistics: SimulationExecutionStatistics;
  readonly provenance: SimulationProvenance;
  readonly metrics: Readonly<Partial<Record<CoreMetricName, number>>> & { readonly averageR: number | null; readonly totalFees: number };
  readonly resultHash: string;
}
