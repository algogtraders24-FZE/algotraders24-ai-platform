// app/api/private/intelligence/panel/route.ts
// Sprint D2.8.16 - the Workspace "AI Intelligence" hero panel's new data
// source, replacing the legacy CopilotAnalysis-based
// /api/private/trading-copilot/analyze call. Reuses the EXACT same
// ResearchSnapshotService the Workspace "Research" panel below it already
// calls (app/api/private/intelligence/research/route.ts) - no second
// engine, no second Intelligence Score, no second regime classification -
// only a different presentation projection
// (intelligence-panel-projection.service.ts) of the identical
// VerifiedAnswerResponse. This is what makes the two panels agree.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { ResearchSnapshotService } from "@/services/intelligence/chat/research-snapshot.service";
import { buildIntelligencePanelDataFromVerifiedAnswer } from "@/services/intelligence/chat/intelligence-panel-projection.service";

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
    return ApiResponse.success({ panel: buildIntelligencePanelDataFromVerifiedAnswer(verifiedAnswer) }, ctx.requestId, 200, ctx.startedAt);
  }

  // insufficient-data / clarification-required / unresolved all honestly
  // mean "no real analysis is available right now" from this panel's point
  // of view - PROVIDER_UNAVAILABLE is the exact code IntelligencePanel.tsx
  // already knows how to render as an honest empty state, never a fabricated
  // "error" state.
  return ApiResponse.error(
    { code: "PROVIDER_UNAVAILABLE", message: `No verified intelligence available for ${symbol} right now.` },
    ctx.requestId,
    503,
    ctx.startedAt,
  );
});
