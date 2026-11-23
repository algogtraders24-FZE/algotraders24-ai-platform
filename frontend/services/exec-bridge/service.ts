// services/exec-bridge/service.ts
// The user-facing side of the Execute bridge: create an order the user confirmed, list the user's orders with their status, cancel a queued one.
// Storage injected. Orders are refused when no Execute EA of the user is connected (a queue nobody reads would only make stale orders).
import { EXEC, execMaxLots } from "./config";
import { parseExecOrderInput, viewStatus, type ExecViewStatus } from "./rules";
import type { ExecOrderRow, ExecStore } from "./store";

export interface ExecOrderView {
  id: string;
  symbol: string;
  side: string;
  kind: string;
  volume: number;
  price: number | null;
  stopLoss: number;
  takeProfit: number | null;
  status: ExecViewStatus;
  expiresAt: string;
  createdAt: string;
  ticket: string | null;
  fillPrice: number | null;
  reason: string | null;
}

export const toView = (r: ExecOrderRow, now: Date): ExecOrderView => ({
  id: r.id, symbol: r.symbol, side: r.side, kind: r.kind, volume: r.volume, price: r.price, stopLoss: r.stopLoss, takeProfit: r.takeProfit,
  status: viewStatus(r, now), expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString(), ticket: r.ticket, fillPrice: r.fillPrice, reason: r.reason,
});

export type CreateResult =
  | { ok: true; order: ExecOrderView; created: boolean }
  | { ok: false; code: "VALIDATION" | "NO_EA" | "QUEUE_FULL" | "RATE_LIMITED"; message: string };

export class ExecOrderService {
  constructor(private readonly store: ExecStore, private readonly now: () => Date = () => new Date()) {}

  async create(userId: string, body: unknown): Promise<CreateResult> {
    const now = this.now();
    const parsed = parseExecOrderInput(body, execMaxLots(), now);
    if (!parsed.ok) return { ok: false, code: "VALIDATION", message: parsed.message };
    const { order, clientNonce, expiresAt, plan } = parsed.value;

    // a repeat of the same confirmation is the same order, whatever has happened to it since
    const existing = (await this.store.listOrders(userId, 50)).find((o) => o.clientNonce === clientNonce);
    if (existing) return { ok: true, order: toView(existing, now), created: false };

    if (!(await this.store.hasFreshDevice(userId, new Date(now.getTime() - EXEC.deviceFreshSec * 1000)))) {
      return { ok: false, code: "NO_EA", message: "Your AT24 Execute EA is not connected. Open MT5, attach the EA with your token, then try again." };
    }
    await this.store.expireDue(userId, now);
    if ((await this.store.countQueued(userId, now)) >= EXEC.maxQueuedPerUser) return { ok: false, code: "QUEUE_FULL", message: "You already have orders waiting. Wait for them or cancel one." };
    if ((await this.store.countCreatedSince(userId, new Date(now.getTime() - 3_600_000))) >= EXEC.maxOrdersPerHour) return { ok: false, code: "RATE_LIMITED", message: "Too many orders in the last hour." };

    const { row, created } = await this.store.createOrder({
      userId, clientNonce, symbol: order.symbol, side: order.side, kind: order.kind, volume: order.volume, price: order.price ?? null, stopLoss: order.stopLoss as number,
      takeProfit: order.takeProfit ?? null, expiresAt, planSnapshot: plan,
    });
    return { ok: true, order: toView(row, now), created };
  }

  async list(userId: string, limit = 20): Promise<ExecOrderView[]> {
    const now = this.now();
    await this.store.expireDue(userId, now);
    return (await this.store.listOrders(userId, Math.min(50, Math.max(1, limit)))).map((r) => toView(r, now));
  }

  async cancel(userId: string, orderId: string): Promise<boolean> {
    return this.store.cancelOrder(userId, orderId);
  }

  async connected(userId: string): Promise<boolean> {
    return this.store.hasFreshDevice(userId, new Date(this.now().getTime() - EXEC.deviceFreshSec * 1000));
  }
}
