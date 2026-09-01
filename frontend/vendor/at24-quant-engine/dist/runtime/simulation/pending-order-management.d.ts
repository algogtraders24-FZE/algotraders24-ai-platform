import type { OHLCVBar } from "../../domain/market-data.js";
import type { SimulationOrder } from "../../domain/simulation/order.js";
import type { OrderModificationIntent } from "../../domain/simulation/order-modification.js";
import type { PendingOrderManagementPolicy } from "../../domain/pending-order-management-policy.js";
/**
 * Evaluates every rule of `policy`, in declared order, against ONE
 * pending order at ONE bar; returns the FIRST rule's resulting intent, or
 * `undefined` if none fire this bar. Deterministic and lookahead-free:
 * the only inputs are `order` (already-known, created on or before this
 * bar by the caller's own same-bar safety guard) and `bar` (the bar
 * currently being processed) — never a future bar, never wall-clock
 * time, never a source of randomness. A rule that failed
 * `executableRules()`'s provability gate is skipped defensively here too
 * (belt-and-braces — the caller is expected to pass only
 * `executableRules(policy)`, but this function never trusts that
 * silently).
 */
export declare function evaluatePendingOrderManagementPolicy(policy: PendingOrderManagementPolicy, order: SimulationOrder, bar: OHLCVBar, reason: string, atrValue?: number): OrderModificationIntent | undefined;
