// app/api/private/workspace/preferences/route.ts
// Sprint D2.3 (Phase 7) - Workspace Profiles. GET returns (creating on first
// access) the session user's workspace preferences; PATCH applies a partial
// update. userId is always taken from the session, never trusted from the
// body. Presentation-only - never touches the AI Intelligence pipeline.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { workspacePreferencesService } from "@/services/workspace/workspace-preferences.service";
import type { WorkspacePreferencesPatch } from "@/types/workspace-preferences";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const data = await workspacePreferencesService.getOrCreate(sessionUser.profile.id);
  return ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
});

export const PATCH = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as WorkspacePreferencesPatch | null;
  if (!body || typeof body !== "object") {
    return ApiResponse.error({ code: "VALIDATION", message: "Request body must be a JSON object" }, ctx.requestId, 400, ctx.startedAt);
  }

  const patch: WorkspacePreferencesPatch = {
    profile: body.profile,
    symbol: body.symbol,
    chartInterval: body.chartInterval,
    favoriteMarkets: body.favoriteMarkets,
    collapsedPanels: body.collapsedPanels,
  };

  const data = await workspacePreferencesService.update(sessionUser.profile.id, patch);
  return ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
});
