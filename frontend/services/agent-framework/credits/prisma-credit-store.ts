// services/agent-framework/credits/prisma-credit-store.ts
// AT24 Agent Framework - A9. The real CreditStore backed by the
// AgentCreditLedgerEntry table. Functional once the A9 migration
// (20260907120000_add_agent_credit_ledger) is applied.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  type CreditStore,
  type StoredLedgerEntry,
  type NewLedgerEntry,
  DuplicateLedgerEntryError,
} from "./credit-store";
import type { AgentCreditEntryKind } from "@/lib/generated/prisma/enums";

type Row = {
  id: string; userId: string; runId: string; stepId: string | null; toolCallId: string | null;
  kind: string; amount: number; balanceAfter: number; idempotencyKey: string; reason: string;
  periodStart: Date; createdAt: Date;
};

function toStored(r: Row): StoredLedgerEntry {
  return {
    id: r.id, userId: r.userId, runId: r.runId, stepId: r.stepId, toolCallId: r.toolCallId,
    kind: r.kind as StoredLedgerEntry["kind"], amount: r.amount, balanceAfter: r.balanceAfter,
    idempotencyKey: r.idempotencyKey, reason: r.reason,
    periodStart: r.periodStart.toISOString(), createdAt: r.createdAt.toISOString(),
  };
}

export class PrismaCreditStore implements CreditStore {
  async insert(entry: NewLedgerEntry): Promise<StoredLedgerEntry> {
    try {
      const row = await prisma.agentCreditLedgerEntry.create({
        data: {
          userId: entry.userId,
          runId: entry.runId,
          stepId: entry.stepId ?? undefined,
          toolCallId: entry.toolCallId ?? undefined,
          kind: entry.kind as AgentCreditEntryKind,
          amount: entry.amount,
          balanceAfter: entry.balanceAfter,
          idempotencyKey: entry.idempotencyKey,
          reason: entry.reason,
          periodStart: new Date(entry.periodStart),
        },
      });
      return toStored(row as unknown as Row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new DuplicateLedgerEntryError(entry.idempotencyKey);
      }
      throw err;
    }
  }

  async findByIdempotencyKey(key: string): Promise<StoredLedgerEntry | null> {
    const r = await prisma.agentCreditLedgerEntry.findUnique({ where: { idempotencyKey: key } });
    return r ? toStored(r as unknown as Row) : null;
  }

  async sumForPeriod(userId: string, periodStart: string): Promise<number> {
    const agg = await prisma.agentCreditLedgerEntry.aggregate({
      where: { userId, periodStart: { gte: new Date(periodStart) } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  async entriesForRun(runId: string): Promise<StoredLedgerEntry[]> {
    const rows = await prisma.agentCreditLedgerEntry.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => toStored(r as unknown as Row));
  }

  async clearForUser(userId: string): Promise<number> {
    const res = await prisma.agentCreditLedgerEntry.deleteMany({ where: { userId } });
    return res.count;
  }
}
