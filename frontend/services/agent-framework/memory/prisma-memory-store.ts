// services/agent-framework/memory/prisma-memory-store.ts
// AT24 Agent Framework - A7. The real MemoryStore backed by the
// AgentMemoryRecord table. Functional once the A7 migration
// (20260906130000_add_agent_memory_record) is applied.
//
// agentType is denormalised into `provenance.agentType` on write and read
// back from there - the AF-v1 AgentMemoryRecord shape carries no dedicated
// column for it, and provenance is already a Json blob the gateway owns.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type { MemoryStore, StoredMemoryRecord, NewMemoryRecord, MemoryQuery } from "./memory-store";
import type { MemoryProvenance, MemoryRetention, MemoryRecordStatus } from "@/types/agent-framework";
import type { AgentMemoryLayer, AgentMemoryRecordStatus } from "@/lib/generated/prisma/enums";

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

type Row = {
  id: string; agentId: string; userId: string; runId: string | null;
  layer: string; scope: string; key: string; value: unknown;
  retention: unknown; provenance: unknown; status: string;
  expiresAt: Date | null; createdAt: Date; updatedAt: Date;
};

function toStored(r: Row): StoredMemoryRecord {
  const prov = (r.provenance ?? {}) as MemoryProvenance & { agentType?: string };
  return {
    id: r.id,
    agentId: r.agentId,
    agentType: typeof prov.agentType === "string" ? prov.agentType : "",
    userId: r.userId,
    runId: r.runId,
    layer: r.layer as StoredMemoryRecord["layer"],
    scope: r.scope,
    key: r.key,
    value: r.value,
    retention: r.retention as MemoryRetention,
    provenance: { origin: prov.origin, producer: prov.producer, runId: prov.runId, stepId: prov.stepId, createdAt: prov.createdAt },
    status: r.status as MemoryRecordStatus,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export class PrismaMemoryStore implements MemoryStore {
  async insert(rec: NewMemoryRecord): Promise<StoredMemoryRecord> {
    const row = await prisma.agentMemoryRecord.create({
      data: {
        agentId: rec.agentId,
        userId: rec.userId,
        runId: rec.runId ?? undefined,
        layer: rec.layer as AgentMemoryLayer,
        scope: rec.scope,
        key: rec.key,
        value: asJson(rec.value),
        retention: asJson(rec.retention),
        provenance: asJson({ ...rec.provenance, agentType: rec.agentType }),
        status: rec.status as AgentMemoryRecordStatus,
        expiresAt: rec.expiresAt ? new Date(rec.expiresAt) : undefined,
      },
    });
    return toStored(row as unknown as Row);
  }

  async query(q: MemoryQuery): Promise<StoredMemoryRecord[]> {
    const rows = await prisma.agentMemoryRecord.findMany({
      where: {
        userId: q.userId,
        layer: q.layer as AgentMemoryLayer,
        deletedAt: null,
        ...(q.agentId ? { agentId: q.agentId } : {}),
        ...(q.scope !== undefined ? { scope: q.scope } : {}),
        ...(q.key !== undefined ? { key: q.key } : {}),
        ...(q.status ? { status: q.status as AgentMemoryRecordStatus } : {}),
        ...(q.notExpiredAsOf ? { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(q.notExpiredAsOf) } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });
    let out = rows.map((r) => toStored(r as unknown as Row));
    // agentType lives in provenance JSON - filter after load.
    if (q.agentType) out = out.filter((r) => r.agentType === q.agentType);
    return out;
  }

  async getById(id: string): Promise<StoredMemoryRecord | null> {
    const r = await prisma.agentMemoryRecord.findUnique({ where: { id } });
    return r ? toStored(r as unknown as Row) : null;
  }

  async markStatus(id: string, status: MemoryRecordStatus): Promise<void> {
    await prisma.agentMemoryRecord.update({
      where: { id },
      data: { status: status as AgentMemoryRecordStatus },
    });
  }

  async clearForUser(userId: string): Promise<number> {
    const res = await prisma.agentMemoryRecord.deleteMany({ where: { userId } });
    return res.count;
  }
}
