/**
 * Every execution attempt produces exactly this structured shape — no
 * free-form-only result (Q0.5.17).
 */
export interface ExecutionResult {
  readonly orderId: string;
  readonly status: "FILLED" | "PARTIALLY_FILLED" | "REJECTED" | "NO_FILL";
  readonly requestedQuantity: number;
  readonly filledQuantity: number;
  readonly requestedPrice?: number;
  readonly fillPrice?: number;
  readonly fees: number;
  readonly slippage: number;
  readonly executionTimestamp: number;
  readonly executionModel: string;
  readonly reason: string;
}
