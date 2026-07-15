// repositories/PrismaWorkflowRepository.ts
// Sprint 14E — Prisma-backed Workflow repository (workflows + runs + queue).
import type {
  WorkflowEntity,
  WorkflowRunEntity,
  WorkflowQueueEntity,
  WorkflowStepEntity,
} from "./WorkflowRepository";
import { PrismaBaseRepository, type PrismaDelegate } from "./PrismaBaseRepository";
import { prisma } from "@/lib/prisma";
import type {
  Workflow as PrismaWorkflow,
  WorkflowRun as PrismaWorkflowRun,
  WorkflowQueueItem as PrismaQueueItem,
} from "@/lib/generated/prisma/client";

export class PrismaWorkflowRepository extends PrismaBaseRepository<WorkflowEntity, PrismaWorkflow> {
  protected entityName = "Workflow";
  protected delegate = prisma.workflow as unknown as PrismaDelegate;

  protected toEntity(row: PrismaWorkflow): WorkflowEntity {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      description: row.description,
      trigger: row.trigger,
      schedule: row.schedule,
      status: row.status,
      steps: (row.steps as unknown as WorkflowStepEntity[]) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected toCreateData(input: Omit<WorkflowEntity, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
    return {
      userId: input.userId,
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      schedule: input.schedule,
      status: input.status,
      steps: input.steps as unknown as object,
    };
  }

  protected toUpdateData(patch: Partial<Omit<WorkflowEntity, "id" | "createdAt">>): Record<string, unknown> {
    return {
      name: patch.name ?? undefined,
      description: patch.description ?? undefined,
      trigger: patch.trigger ?? undefined,
      schedule: patch.schedule ?? undefined,
      status: patch.status ?? undefined,
      steps: patch.steps ? (patch.steps as unknown as object) : undefined,
    };
  }

  async findByUser(userId: string): Promise<WorkflowEntity[]> {
    return this.run("findByUser", async () => {
      const rows = (await this.delegate.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      })) as PrismaWorkflow[];
      return rows.map((r) => this.toEntity(r));
    });
  }

  async runsByUser(userId: string): Promise<WorkflowRunEntity[]> {
    return this.run("runsByUser", async () => {
      const rows = (await prisma.workflowRun.findMany({
        where: { userId, deletedAt: null },
        orderBy: { startedAt: "desc" },
      })) as PrismaWorkflowRun[];
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        workflowId: r.workflowId,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        durationMs: r.durationMs,
        log: (r.log as unknown as string[]) ?? [],
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.createdAt.toISOString(),
      }));
    });
  }

  async queueByUser(userId: string): Promise<WorkflowQueueEntity[]> {
    return this.run("queueByUser", async () => {
      const rows = (await prisma.workflowQueueItem.findMany({
        where: { userId, deletedAt: null },
        orderBy: { enqueuedAt: "desc" },
      })) as PrismaQueueItem[];
      return rows.map((q) => ({
        id: q.id,
        userId: q.userId,
        workflowId: q.workflowId,
        status: q.status,
        enqueuedAt: q.enqueuedAt.toISOString(),
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.createdAt.toISOString(),
      }));
    });
  }
}
