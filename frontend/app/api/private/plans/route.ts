// app/api/private/plans/route.ts
// Sprint 14D - Plan catalogue from the database.
// Security: explicit in-handler auth (defense-in-depth, matches other private routes).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { prisma } from "@/lib/prisma";
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

  const rows = await prisma.plan.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  const items = rows.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    interval: p.interval,
    features: p.features,
    sortOrder: p.sortOrder,
  }));

  return ApiResponse.success(
    { items, total: items.length },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});
