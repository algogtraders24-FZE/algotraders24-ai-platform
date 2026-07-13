// repositories/PrismaAutomationRepository.ts
// Sprint 14D - Prisma-backed AutomationRepository.
import type { AutomationEntity } from "./AutomationRepository";
import { PrismaBaseRepository, type PrismaDelegate } from "./PrismaBaseRepository";
import { prisma } from "@/lib/prisma";
import type { Automation as PrismaAutomation } from "@/lib/generated/prisma/client";

export class PrismaAutomationRepository extends PrismaBaseRepository<AutomationEntity, PrismaAutomation> {
  protected entityName = "Automation";
  protected delegate = prisma.automation as unknown as PrismaDelegate;

  protected toEntity(row: PrismaAutomation): AutomationEntity {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      trigger: row.trigger,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected toCreateData(input: Omit<AutomationEntity, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
    return {
      userId: input.userId,
      name: input.name,
      trigger: input.trigger,
      enabled: input.enabled,
    };
  }

  protected toUpdateData(patch: Partial<Omit<AutomationEntity, "id" | "createdAt">>): Record<string, unknown> {
    return {
      userId: patch.userId ?? undefined,
      name: patch.name ?? undefined,
      trigger: patch.trigger ?? undefined,
      enabled: patch.enabled ?? undefined,
    };
  }

  async findByUser(userId: string): Promise<AutomationEntity[]> {
    return this.run("findByUser", async () => {
      const rows = (await this.delegate.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } })) as PrismaAutomation[];
      return rows.map((r) => this.toEntity(r));
    });
  }
}
