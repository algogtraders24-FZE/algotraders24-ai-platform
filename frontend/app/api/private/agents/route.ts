// app/api/private/agents/route.ts
// Sprint 14D - Repository-backed, scoped to the authenticated user.
// Sprint 14E - Returns agents with their tasks, memory and activity now that
// the agent framework is fully persisted.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";

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

  const [agents, tasks, memory, activity] = await Promise.all([
    prisma.agent.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
    prisma.agentTask.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentMemory.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentActivity.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const items = agents.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    description: a.description,
    avatar: a.avatar,
    status: a.status,
    provider: a.provider,
    version: a.version,
    memoryEnabled: a.memoryEnabled,
    tools: a.tools,
    capabilities: a.capabilities,
    goal: a.goal,
    priority: a.priority,
    lastRun: a.lastRun ? a.lastRun.toISOString() : null,
    nextRun: a.nextRun ? a.nextRun.toISOString() : null,
    tasksCompleted: a.tasksCompleted,
    successRate: a.successRate,
    estimatedCost: a.estimatedCost,
  }));

  const taskItems = tasks.map((t) => ({
    id: t.id,
    agentId: t.agentId,
    title: t.title,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    finishedAt: t.finishedAt ? t.finishedAt.toISOString() : null,
  }));

  const memoryItems = memory.map((m) => ({
    id: m.id,
    agentId: m.agentId,
    key: m.key,
    value: m.value,
    createdAt: m.createdAt.toISOString(),
  }));

  const activityItems = activity.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    message: a.message,
    timestamp: a.createdAt.toISOString(),
  }));

  return ApiResponse.success(
    {
      items,
      tasks: taskItems,
      memory: memoryItems,
      activity: activityItems,
      total: items.length,
    },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});