// app/api/version/route.ts
// Admin-only. Build and release names are internal (and public version strings help someone match known issues to us).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { versionService } from "@/services/backend/VersionService";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const info = versionService.get();
  return ApiResponse.success(info, ctx.requestId, 200, ctx.startedAt);
});
