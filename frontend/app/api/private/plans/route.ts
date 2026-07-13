// app/api/private/plans/route.ts
// Sprint 14D - Plan catalogue from the database.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { prisma } from "@/lib/prisma";

export const GET = withContext(async (_req, ctx) => {
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