// services/credits/bonusStore.ts
// (Server only.) Storage for bonus credit grants: the real Prisma store and an in-memory one for the validator.
// Every method is safe to call when the table does not exist yet (the migration is applied separately): callers wrap in try/catch.
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type { BonusKind, GrantRow } from "@/lib/credits/bonus";

export interface BonusStore {
  /** Creates the grant unless this (user, kind) already has one. Returns true only when a new grant was created. */
  grant(userId: string, kind: BonusKind, amount: number, expiresAt: Date): Promise<boolean>;
  /** Spends one credit from the grant that expires first. Returns false when nothing spendable is left. */
  consumeOne(userId: string, now: Date): Promise<boolean>;
  list(userId: string): Promise<GrantRow[]>;
}

export function prismaBonusStore(): BonusStore {
  return {
    async grant(userId, kind, amount, expiresAt) {
      try {
        await prisma.bonusCreditGrant.create({ data: { userId, kind, amount, remaining: amount, expiresAt } });
        return true;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false; // already granted for this step
        throw e;
      }
    },
    async consumeOne(userId, now) {
      // One atomic statement: pick the soonest-expiring grant that still has credits and take one. SKIP LOCKED so two parallel messages never spend the same credit.
      const changed = await prisma.$executeRaw`
        UPDATE bonus_credit_grants SET remaining = remaining - 1
        WHERE id = (
          SELECT id FROM bonus_credit_grants
          WHERE "userId" = ${userId} AND remaining > 0 AND "expiresAt" > ${now}
          ORDER BY "expiresAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )`;
      return Number(changed) > 0;
    },
    async list(userId) {
      const rows = await prisma.bonusCreditGrant.findMany({ where: { userId }, select: { kind: true, amount: true, remaining: true, expiresAt: true } });
      return rows;
    },
  };
}

export function memoryBonusStore(): BonusStore & { rows: Array<GrantRow & { userId: string }> } {
  const rows: Array<GrantRow & { userId: string }> = [];
  return {
    rows,
    async grant(userId, kind, amount, expiresAt) {
      if (rows.some((r) => r.userId === userId && r.kind === kind)) return false;
      rows.push({ userId, kind, amount, remaining: amount, expiresAt });
      return true;
    },
    async consumeOne(userId, now) {
      const live = rows.filter((r) => r.userId === userId && r.remaining > 0 && r.expiresAt.getTime() > now.getTime()).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      if (live.length === 0) return false;
      live[0].remaining -= 1;
      return true;
    },
    async list(userId) {
      return rows.filter((r) => r.userId === userId).map((r) => ({ kind: r.kind, amount: r.amount, remaining: r.remaining, expiresAt: r.expiresAt }));
    },
  };
}
