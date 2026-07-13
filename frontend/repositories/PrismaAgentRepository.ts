// repositories/PrismaAgentRepository.ts
// Sprint 14D - Prisma-backed AgentRepository.
import type { AgentEntity } from "./AgentRepository";
import { PrismaBaseRepository, type PrismaDelegate } from "./PrismaBaseRepository";
import { prisma } from "@/lib/prisma";
import type { Agent as PrismaAgent } from "@/lib/generated/prisma/client";

function narrowStatus(v: string): AgentEntity["status"] {
  return v === "paused" || v === "archived" ? v : "active";
}

export class PrismaAgentRepository extends PrismaBaseRepository<AgentEntity, PrismaAgent> {
  protected entityName = "Agent";
  protected delegate = prisma.agent as unknown as PrismaDelegate;

  protected toEntity(row: PrismaAgent): AgentEntity {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      type: row.type,
      status: narrowStatus(row.status),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected toCreateData(input: Omit<AgentEntity, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
    return {
      userId: input.userId,
      name: input.name,
      type: input.type,
      status: input.status,
    };
  }

  protected toUpdateData(patch: Partial<Omit<AgentEntity, "id" | "createdAt">>): Record<string, unknown> {
    return {
      userId: patch.userId ?? undefined,
      name: patch.name ?? undefined,
      type: patch.type ?? undefined,
      status: patch.status ?? undefined,
    };
  }

  async findByUser(userId: string): Promise<AgentEntity[]> {
    return this.run("findByUser", async () => {
      const rows = (await this.delegate.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } })) as PrismaAgent[];
      return rows.map((r) => this.toEntity(r));
    });
  }
}
