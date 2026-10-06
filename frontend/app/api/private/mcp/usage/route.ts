// app/api/private/mcp/usage/route.ts
// AT24 MCP v1 - the signed-in user's own MCP usage today + recent calls.
// Session-authenticated; every query is scoped to the session user's id.
// Reads McpCallLog (metadata only: tool, ok, errorCode, duration, time).

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/services/mcp/quota";
import { buildUsageSummary } from "@/services/mcp/usage";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);

  const now = new Date();
  const since = startOfUtcDay(now);
  const [grouped, recent] = await Promise.all([
    prisma.mcpCallLog.groupBy({ by: ["tool"], where: { userId: user.profile.id, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.mcpCallLog.findMany({
      where: { userId: user.profile.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { tool: true, ok: true, errorCode: true, durationMs: true, createdAt: true },
    }),
  ]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.tool] = g._count._all;

  const summary = buildUsageSummary({ serviceEnabled: process.env.MCP_ENABLED === "true", counts, recent, now });
  return ApiResponse.success(summary, ctx.requestId, 200, ctx.startedAt);
});
