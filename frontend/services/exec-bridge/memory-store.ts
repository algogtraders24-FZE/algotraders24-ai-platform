// services/exec-bridge/memory-store.ts
// In-memory ExecStore for tests (same semantics as the Prisma store: idempotent create, atomic claim, report only from "sent").
import type { ExecDeviceRecord, ExecOrderRow, ExecStore, NewExecOrder } from "./store";
import type { ExecReport } from "./rules";

export class MemoryExecStore implements ExecStore {
  devices = new Map<string, ExecDeviceRecord & { tokenHash: string }>();
  orders: ExecOrderRow[] = [];
  private seq = 0;

  addDevice(userId: string, tokenHash: string, opts: { revoked?: boolean; userStatus?: string; lastSeenAt?: Date | null } = {}): string {
    const id = `dev${++this.seq}`;
    this.devices.set(id, { id, userId, tokenHash, revokedAt: opts.revoked ? new Date() : null, lastSeenAt: opts.lastSeenAt ?? null, userStatus: opts.userStatus ?? "active" });
    return id;
  }

  async deviceByHash(tokenHash: string) {
    for (const d of this.devices.values()) if (d.tokenHash === tokenHash) return d;
    return null;
  }
  async touchDevice(deviceId: string, at: Date) {
    const d = this.devices.get(deviceId);
    if (d) d.lastSeenAt = at;
  }
  async hasFreshDevice(userId: string, since: Date) {
    return [...this.devices.values()].some((d) => d.userId === userId && !d.revokedAt && d.lastSeenAt !== null && d.lastSeenAt.getTime() >= since.getTime());
  }
  async createOrder(data: NewExecOrder) {
    const existing = this.orders.find((o) => o.userId === data.userId && o.clientNonce === data.clientNonce);
    if (existing) return { row: existing, created: false };
    const row: ExecOrderRow = {
      id: `ord${++this.seq}xxxxxxxx`, userId: data.userId, clientNonce: data.clientNonce, symbol: data.symbol, side: data.side, kind: data.kind, volume: data.volume,
      price: data.price, stopLoss: data.stopLoss, takeProfit: data.takeProfit, status: "queued", expiresAt: data.expiresAt, confirmedAt: new Date(), claimedAt: null,
      reportedAt: null, ticket: null, fillPrice: null, retcode: null, reason: null, createdAt: new Date(),
    };
    this.orders.push(row);
    return { row, created: true };
  }
  async countQueued(userId: string, now: Date) {
    return this.orders.filter((o) => o.userId === userId && o.status === "queued" && o.expiresAt.getTime() > now.getTime()).length;
  }
  async countCreatedSince(userId: string, since: Date) {
    return this.orders.filter((o) => o.userId === userId && o.createdAt.getTime() >= since.getTime()).length;
  }
  async listOrders(userId: string, limit: number) {
    return this.orders.filter((o) => o.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
  async cancelOrder(userId: string, orderId: string) {
    const o = this.orders.find((x) => x.id === orderId && x.userId === userId && x.status === "queued");
    if (!o) return false;
    o.status = "cancelled";
    return true;
  }
  async expireDue(userId: string, now: Date) {
    for (const o of this.orders) if (o.userId === userId && o.status === "queued" && o.expiresAt.getTime() <= now.getTime()) o.status = "expired";
  }
  async claimNext(userId: string, _deviceId: string, now: Date) {
    const next = this.orders.filter((o) => o.userId === userId && o.status === "queued" && o.expiresAt.getTime() > now.getTime()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!next) return null;
    next.status = "sent";
    next.claimedAt = now;
    return next;
  }
  async applyReport(userId: string, r: ExecReport, now: Date) {
    const o = this.orders.find((x) => x.id === r.orderId && x.userId === userId);
    if (!o) return "not_found" as const;
    if (o.status !== "sent") return "bad_state" as const;
    o.status = r.outcome;
    o.reportedAt = now;
    o.ticket = r.ticket ?? null;
    o.fillPrice = r.price ?? null;
    o.retcode = r.retcode ?? null;
    o.reason = r.reason ?? null;
    return "ok" as const;
  }
}
