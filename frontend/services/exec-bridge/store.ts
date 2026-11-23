// services/exec-bridge/store.ts
// Storage contract of the Execute bridge (injected, so the logic is tested with an in-memory store and runs on Prisma in production).
import type { ExecReport } from "./rules";

export interface ExecDeviceRecord {
  id: string;
  userId: string;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  /** The owner's account status; "active" is required. */
  userStatus: string;
}

export interface ExecOrderRow {
  id: string;
  userId: string;
  clientNonce: string;
  symbol: string;
  side: string;
  kind: string;
  volume: number;
  price: number | null;
  stopLoss: number;
  takeProfit: number | null;
  status: string;
  expiresAt: Date;
  confirmedAt: Date;
  claimedAt: Date | null;
  reportedAt: Date | null;
  ticket: string | null;
  fillPrice: number | null;
  retcode: number | null;
  reason: string | null;
  createdAt: Date;
}

export interface NewExecOrder {
  userId: string;
  clientNonce: string;
  symbol: string;
  side: string;
  kind: string;
  volume: number;
  price: number | null;
  stopLoss: number;
  takeProfit: number | null;
  expiresAt: Date;
  planSnapshot: Record<string, unknown> | null;
}

export interface ExecStore {
  deviceByHash(tokenHash: string): Promise<ExecDeviceRecord | null>;
  touchDevice(deviceId: string, at: Date): Promise<void>;
  /** Was any of the user's execute devices seen at or after `since`? */
  hasFreshDevice(userId: string, since: Date): Promise<boolean>;
  /** Idempotent on (userId, clientNonce): a repeat returns the existing row with created=false. */
  createOrder(data: NewExecOrder): Promise<{ row: ExecOrderRow; created: boolean }>;
  countQueued(userId: string, now: Date): Promise<number>;
  countCreatedSince(userId: string, since: Date): Promise<number>;
  listOrders(userId: string, limit: number): Promise<ExecOrderRow[]>;
  /** Cancels only a still-queued order. */
  cancelOrder(userId: string, orderId: string): Promise<boolean>;
  /** Marks queued orders past their expiry as expired. */
  expireDue(userId: string, now: Date): Promise<void>;
  /** Atomically hands the oldest live queued order of the user to a device (queued -> sent); two pollers can never get the same order. */
  claimNext(userId: string, deviceId: string, now: Date): Promise<ExecOrderRow | null>;
  /** Applies the EA's report to an order claimed (sent) by one of the user's devices. */
  applyReport(userId: string, report: ExecReport, now: Date): Promise<"ok" | "not_found" | "bad_state">;
}
