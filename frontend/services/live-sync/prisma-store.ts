// services/live-sync/prisma-store.ts
// AT24 Live Sync (P1) - Prisma-backed stores. Kept out of the pure modules so the
// logic is tested without a database. Every user-facing query includes userId.

import { prisma } from "@/lib/prisma";
import type { DeviceRecord, DeviceStore } from "./auth";
import type { AccountRow, CommitArgs, LiveSyncStore } from "./ingest";

const accountRow = (a: { id: string; chainSeq: number; chainHead: string; lastSnapshotAt: Date | null }): AccountRow => ({
  id: a.id,
  chainSeq: a.chainSeq,
  chainHead: a.chainHead,
  lastSnapshotAt: a.lastSnapshotAt,
});

export const prismaDeviceStore: DeviceStore = {
  async findByHash(tokenHash): Promise<DeviceRecord | null> {
    const d = await prisma.liveSyncDevice.findUnique({ where: { tokenHash } });
    if (!d) return null;
    const user = await prisma.user.findUnique({ where: { id: d.userId }, select: { status: true } });
    return { id: d.id, userId: d.userId, revokedAt: d.revokedAt, lastSeenAt: d.lastSeenAt, userStatus: user?.status ?? "missing" };
  },
  async touch(deviceId, at) {
    await prisma.liveSyncDevice.update({ where: { id: deviceId }, data: { lastSeenAt: at } });
  },
};

const ZERO = "0".repeat(64);

export const prismaLiveSyncStore: LiveSyncStore = {
  async getAccount(userId, accountKey) {
    const a = await prisma.liveSyncAccount.findUnique({ where: { userId_accountKey: { userId, accountKey } } });
    return a ? accountRow(a) : null;
  },
  countAccounts: (userId) => prisma.liveSyncAccount.count({ where: { userId } }),
  async createAccount(userId, accountKey, facts, now) {
    // upsert: two first requests racing for the same new account must not fail
    const a = await prisma.liveSyncAccount.upsert({
      where: { userId_accountKey: { userId, accountKey } },
      update: {},
      create: { userId, accountKey, ...facts, chainSeq: 0, chainHead: ZERO, firstSyncAt: now, lastSyncAt: now },
    });
    return accountRow(a);
  },
  async commit(args: CommitArgs) {
    const { accountId, now, facts, chain, snapshot } = args;
    return prisma.$transaction(async (tx) => {
      let insertedDeals = 0;
      if (chain) {
        const res = await tx.liveSyncDeal.createMany({
          skipDuplicates: true,
          data: chain.deals.map((d) => ({
            accountId,
            dealTicket: BigInt(d.ticket),
            positionId: BigInt(d.positionId),
            timeMsc: BigInt(d.timeMsc),
            timeUtc: d.timeUtc,
            symbol: d.symbol,
            type: d.type,
            entry: d.entry,
            volume: d.volume,
            price: d.price,
            commission: d.commission,
            swap: d.swap,
            profit: d.profit,
            fee: d.fee,
            magic: BigInt(d.magic),
            comment: d.comment,
            batchSeq: chain.seq,
          })),
        });
        insertedDeals = res.count;
        await tx.liveSyncBatch.create({ data: { accountId, seq: chain.seq, prevHash: chain.prevHash, hash: chain.hash, dealCount: chain.deals.length, receivedAt: now } });
      }
      if (snapshot) {
        await tx.liveSyncSnapshot.create({
          data: {
            accountId,
            timeUtc: snapshot.timeUtc,
            balance: snapshot.data.balance,
            equity: snapshot.data.equity,
            margin: snapshot.data.margin,
            freeMargin: snapshot.data.freeMargin,
            positions: snapshot.data.positions as unknown as object,
          },
        });
      }
      await tx.liveSyncAccount.update({
        where: { id: accountId },
        data: {
          lastSyncAt: now,
          currency: facts.currency,
          mode: facts.mode,
          marginMode: facts.marginMode,
          leverage: facts.leverage,
          serverUtcOffsetSec: facts.serverUtcOffsetSec,
          terminalBuild: facts.terminalBuild,
          ...(chain ? { chainSeq: chain.seq, chainHead: chain.hash } : {}),
          ...(snapshot ? { lastSnapshotAt: now, lastBalance: snapshot.data.balance, lastEquity: snapshot.data.equity } : {}),
        },
      });
      return { insertedDeals };
    });
  },
};

/** Deletes one of the user's synced accounts and ALL of its data. True if a row was removed. */
export async function deleteSyncedAccount(userId: string, accountId: string): Promise<boolean> {
  const acc = await prisma.liveSyncAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!acc) return false;
  await prisma.$transaction([
    prisma.liveSyncDeal.deleteMany({ where: { accountId } }),
    prisma.liveSyncBatch.deleteMany({ where: { accountId } }),
    prisma.liveSyncSnapshot.deleteMany({ where: { accountId } }),
    prisma.liveSyncAccount.delete({ where: { id: accountId } }),
  ]);
  return true;
}
