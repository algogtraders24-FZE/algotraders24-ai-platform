// app/api/private/products/route.ts
// Sprint 14D - Repository-backed. Auth enforced by middleware.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";

export const GET = withContext(async (req, ctx) => {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 20);

  const items = await RepositoryFactory.products().findAll();
  const total = items.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return ApiResponse.success(
    { items: paged, total, page, pageSize, mode: RepositoryFactory.mode() },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});