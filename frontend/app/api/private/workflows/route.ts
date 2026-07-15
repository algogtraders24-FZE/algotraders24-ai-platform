// app/api/private/workflows/route.ts
// Sprint 14E - Workflow dashboard data (workflows + runs + queue), user-scoped.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { PrismaWorkflowRepository } from "@/repositories/PrismaWorkflowRepository";
import { getUserOrNull } from "@/lib/auth/protectedRoute";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      ctx.requestId,
      401,
      ctx.startedAt
    );
  }

  const userId = sessionUser.profile.id;
  const repo = RepositoryFactory.workflows();
  const workflows = await repo.findByUser(userId);

  // Runs + queue are Prisma-only extras; degrade gracefully in mock mode.
  let runs: unknown[] = [];
  let queue: unknown[] = [];
  if (repo instanceof PrismaWorkflowRepository) {
    runs = await repo.runsByUser(userId);
    queue = await repo.queueByUser(userId);
  }

  return ApiResponse.success(
    {
      workflows,
      runs,
      queue,
      total: workflows.length,
      mode: RepositoryFactory.mode(),
    },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});
