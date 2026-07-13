// repositories/PrismaBillingRepository.ts
// Sprint 14D - Prisma-backed BillingRepository.
import type { BillingEntity } from "./BillingRepository";
import { PrismaBaseRepository, type PrismaDelegate } from "./PrismaBaseRepository";
import { prisma } from "@/lib/prisma";
import type { Billing as PrismaBilling } from "@/lib/generated/prisma/client";

function narrowStatus(v: string): BillingEntity["status"] {
  return v === "canceled" || v === "past_due" ? v : "active";
}

export class PrismaBillingRepository extends PrismaBaseRepository<BillingEntity, PrismaBilling> {
  protected entityName = "Billing";
  protected delegate = prisma.billing as unknown as PrismaDelegate;

  protected toEntity(row: PrismaBilling): BillingEntity {
    return {
      id: row.id,
      userId: row.userId,
      planId: row.planId,
      status: narrowStatus(row.status),
      amount: row.amount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected toCreateData(input: Omit<BillingEntity, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
    return {
      userId: input.userId,
      planId: input.planId,
      status: input.status,
      amount: input.amount,
    };
  }

  protected toUpdateData(patch: Partial<Omit<BillingEntity, "id" | "createdAt">>): Record<string, unknown> {
    return {
      userId: patch.userId ?? undefined,
      planId: patch.planId ?? undefined,
      status: patch.status ?? undefined,
      amount: patch.amount ?? undefined,
    };
  }

  async findByUser(userId: string): Promise<BillingEntity[]> {
    return this.run("findByUser", async () => {
      const rows = (await this.delegate.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } })) as PrismaBilling[];
      return rows.map((r) => this.toEntity(r));
    });
  }
}
