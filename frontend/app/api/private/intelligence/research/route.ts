// app/api/private/intelligence/research/route.ts
// Sprint D2.6.11 - Universal Instrument Workspace, Dynamic Chart Resolution
// & Live Workspace Integration. A thin, read-only endpoint over
// ResearchSnapshotService, powering the Workspace Research panel. Follows
// the same withContext/ApiResponse/getUserOrNull pattern every other
// private route in this project already uses (see app/api/private/
// instruments/search/route.ts). Never imports a D2.5/D2.6 internal engine
// directly - only the chat-facing ResearchSnapshotService, preserving the
// same frontend/server boundary D2.6.5 established (see
// docs/architecture/D2.6.11-universal-instrument-workspace-spec.md §7).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { ResearchSnapshotService } from "@/services/intelligence/chat/research-snapshot.service";

const researchSnapshotService = new ResearchSnapshotService();

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const symbol = new URL(req.url).searchParams.get("symbol");
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    return ApiResponse.error({ code: "VALIDATION", message: "symbol query parameter is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const { context, verifiedAnswer } = await researchSnapshotService.build({
    requestId: ctx.requestId,
    userId: sessionUser.profile.id,
    symbol,
  });

  if (context.status === "resolved" && verifiedAnswer) {
    return ApiResponse.success({ status: "resolved", verifiedAnswer }, ctx.requestId, 200, ctx.startedAt);
  }
  if (context.status === "insufficient-data") {
    return ApiResponse.success(
      { status: "insufficient-data", dataFreshness: context.dataQuality?.state ?? "unavailable" },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  }
  if (context.status === "clarification-required") {
    return ApiResponse.success({ status: "clarification-required", message: context.clarification?.message }, ctx.requestId, 200, ctx.startedAt);
  }
  return ApiResponse.success({ status: "unresolved" }, ctx.requestId, 200, ctx.startedAt);
});
