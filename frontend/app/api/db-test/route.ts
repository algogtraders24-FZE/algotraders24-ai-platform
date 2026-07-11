// app/api/db-test/route.ts
// Sprint 14B — Verifies the live Prisma + Supabase connection.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { prisma } from "@/lib/prisma";

export const GET = withContext(async (_req, ctx) => {
  const userCount = await prisma.user.count();
  const users = await prisma.user.findMany({ take: 5 });

  return ApiResponse.success(
    { connected: true, userCount, users },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});
