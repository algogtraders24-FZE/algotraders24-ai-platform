// app/api/version/route.ts
// Sprint 14A — Backend Foundation

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { versionService } from "@/services/backend/VersionService";

export const GET = withContext(async (_req, ctx) => {
  const info = versionService.get();
  return ApiResponse.success(info, ctx.requestId, 200, ctx.startedAt);
});
