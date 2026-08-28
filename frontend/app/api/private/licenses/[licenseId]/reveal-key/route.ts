// app/api/private/licenses/[licenseId]/reveal-key/route.ts
// Sprint M13 (closing the marketplace delivery loop) - buyer-facing,
// browser-session-authenticated (unlike /api/license/* which authenticates
// via the license's own apiKey - see that route's own comment). Lets the
// buyer who owns this License generate a fresh runtime API key and see it
// exactly once, to paste into their EA's InpApiKey input. See
// licenseService.ts's regenerateApiKey for why there is no "show my
// existing key" operation.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { regenerateApiKey } from "@/services/licensing/licenseService";

function licenseIdFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("licenses");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const licenseId = licenseIdFromPath(ctx.path);
  if (!licenseId) {
    return ApiResponse.error({ code: "VALIDATION", message: "license id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const result = await regenerateApiKey(licenseId, sessionUser.profile.id);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : 403;
    return ApiResponse.error({ code: result.code, message: result.code === "NOT_FOUND" ? "License not found" : "This license does not belong to you" }, ctx.requestId, status, ctx.startedAt);
  }

  return ApiResponse.success({ rawApiKey: result.rawApiKey }, ctx.requestId, 200, ctx.startedAt);
});
