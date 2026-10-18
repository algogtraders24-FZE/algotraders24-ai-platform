// app/api/private/licenses/[licenseId]/move-account/route.ts
// "Change trading account" for the signed-in buyer's own licence.
//   GET  -> { boundAccounts, remaining, nextAllowedAt }
//   POST -> frees the account the key is bound to (limited to 2 per 30 days); the next account that runs the EA takes the slot
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getMoveStatus, moveLicenseAccount } from "@/services/licensing/moveAccountStore";

function licenseIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("licenses");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const licenseId = licenseIdFromPath(ctx.path);
  if (!licenseId) return ApiResponse.error({ code: "VALIDATION", message: "licence id is required" }, ctx.requestId, 400, ctx.startedAt);
  const status = await getMoveStatus(licenseId, user.profile.id);
  if (!status) return ApiResponse.error({ code: "NOT_FOUND", message: "Licence not found" }, ctx.requestId, 404, ctx.startedAt);
  return ApiResponse.success(status, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const licenseId = licenseIdFromPath(ctx.path);
  if (!licenseId) return ApiResponse.error({ code: "VALIDATION", message: "licence id is required" }, ctx.requestId, 400, ctx.startedAt);
  const r = await moveLicenseAccount(licenseId, user.profile.id);
  if (!r.ok) {
    const status = r.code === "NOT_FOUND" ? 404 : r.code === "FORBIDDEN" ? 403 : r.code === "LIMIT_REACHED" ? 429 : 409;
    return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, status, ctx.startedAt);
  }
  return ApiResponse.success({ moved: true, remaining: r.remaining }, ctx.requestId, 200, ctx.startedAt);
});
