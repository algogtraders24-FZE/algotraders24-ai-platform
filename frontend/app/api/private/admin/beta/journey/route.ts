// app/api/private/admin/beta/journey/route.ts
// Sprint R1.2 - Phase 3: a single user's onboarding milestone timeline.
// Query-param filtered (?userId=), same convention as audit-logs' own
// filtering, rather than a new dynamic route segment.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminBetaService } from "@/services/admin/AdminBetaService";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return ApiResponse.error({ code: "VALIDATION", message: "userId query param is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const journey = await adminBetaService.getUserJourney(userId);
  if (!journey) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "User not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ journey }, ctx.requestId, 200, ctx.startedAt);
});
