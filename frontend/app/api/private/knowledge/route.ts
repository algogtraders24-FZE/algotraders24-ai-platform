// app/api/private/knowledge/route.ts
// Sprint 14D - Repository-backed, scoped to the authenticated user.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
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

  const items = await RepositoryFactory.knowledge().findByUser(sessionUser.profile.id);
  return ApiResponse.success(
    { items, total: items.length, mode: RepositoryFactory.mode() },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});