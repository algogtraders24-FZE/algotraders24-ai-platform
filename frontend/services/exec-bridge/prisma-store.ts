// services/exec-bridge/prisma-store.ts
// Prisma implementation of the ExecStore. Every query is scoped to the user id; the claim and the report are conditional updates, so a race can never
// hand one order to two pollers or apply two reports.
import { prisma } from "@/lib/prisma";
import type { ExecDeviceRecord, ExecOrderRow, ExecStore, NewExecOrder } from "./store";
import type { ExecReport } from "./rules";

const ORDER_SELECT = {
  id: true, userId: true, clientNonce: true, symbol: true, side: true, kind: true, volume: true, price: true, stopLoss: true, takeProfit: true, status: true,
  expiresAt: true, confirmedAt: true, claimedAt: true, reportedAt: true, ticket: true, fillPrice: true, retcode: true, reason: true, createdAt: true,
} as const;

export const prismaExecStore: ExecStore = {
  async deviceByHash(tokenHash): Promise<ExecDeviceRecord | null> {
    const d = await prisma.execDevice.findUnique({ where: { tokenHash }, select: { id: true, userId: true, revokedAt: true, lastSeenAt: true } });
    if (!d) return null;
    const u = await prisma.user.findUnique({ where: { id: d.userId }, select: { status: true } });
    return { ...d, userStatus: u?.status ?? "missing" };
  },

  async touchDevice(deviceId, at) {
    await prisma.execDevice.update({ where: { id: deviceId }, data: { lastSeenAt: at } });
  },

  async hasFreshDevice(userId, since) {
    const n = await prisma.execDevice.count({ where: { userId, revokedAt: null, lastSeenAt: { gte: since } } });
    return n > 0;
  },

  async createOrder(data: NewExecOrder) {
    const existing = await prisma.execOrder.findUnique({ where: { userId_clientNonce: { userId: data.userId, clientNonce: data.clientNonce } }, select: ORDER_SELECT });
    if (existing) return { row: existing, created: false };
    try {
      const row = await prisma.execOrder.create({
        data: {
          userId: data.userId, clientNonce: data.clientNonce, symbol: data.symbol, side: data.side, kind: data.kind, volume: data.volume, price: data.price,
          stopLoss: data.stopLoss, takeProfit: data.takeProfit, expiresAt: data.expiresAt, planSnapshot: (data.planSnapshot ?? undefined) as never,
        },
        select: ORDER_SELECT,
      });
      return { row, created: true };
    } catch {
      // a concurrent identical request created it first: the same order, not a new one
      const again = await prisma.execOrder.findUnique({ where: { userId_clientNonce: { userId: data.userId, clientNonce: data.clientNonce } }, select: ORDER_SELECT });
      if (again) return { row: again, created: false };
      throw new Error("could not create the order");
    }
  },

  async countQueued(userId, now) {
    return prisma.execOrder.count({ where: { userId, status: "queued", expiresAt: { gt: now } } });
  },

  async countCreatedSince(userId, since) {
    return prisma.execOrder.count({ where: { userId, createdAt: { gte: since } } });
  },

  async listOrders(userId, limit) {
    return prisma.execOrder.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit, select: ORDER_SELECT });
  },

  async cancelOrder(userId, orderId) {
    const r = await prisma.execOrder.updateMany({ where: { id: orderId, userId, status: "queued" }, data: { status: "cancelled" } });
    return r.count === 1;
  },

  async expireDue(userId, now) {
    await prisma.execOrder.updateMany({ where: { userId, status: "queued", expiresAt: { lte: now } }, data: { status: "expired" } });
  },

  async claimNext(userId, deviceId, now) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = await prisma.execOrder.findFirst({ where: { userId, status: "queued", expiresAt: { gt: now } }, orderBy: { createdAt: "asc" }, select: ORDER_SELECT });
      if (!next) return null;
      const claimed = await prisma.execOrder.updateMany({ where: { id: next.id, status: "queued" }, data: { status: "sent", claimedAt: now, claimedBy: deviceId } });
      if (claimed.count === 1) return { ...next, status: "sent", claimedAt: now };
    }
    return null;
  },

  async applyReport(userId, r: ExecReport, now) {
    const row = await prisma.execOrder.findFirst({ where: { id: r.orderId, userId }, select: { id: true, status: true } });
    if (!row) return "not_found";
    const done = await prisma.execOrder.updateMany({
      where: { id: r.orderId, userId, status: "sent" },
      data: { status: r.outcome, reportedAt: now, ticket: r.ticket ?? null, fillPrice: r.price ?? null, retcode: r.retcode ?? null, reason: r.reason ?? null },
    });
    return done.count === 1 ? "ok" : "bad_state";
  },
};
