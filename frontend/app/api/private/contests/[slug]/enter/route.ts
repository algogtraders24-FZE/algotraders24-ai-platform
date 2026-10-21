// app/api/private/contests/[slug]/enter/route.ts
// POST { accountId, alias } -> enters the signed-in user in the contest with one of their Live Sync DEMO accounts.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { enterContest } from "@/services/contest/contestService";

function slugFromPath(path: string): string | undefined {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  const idx = segments.indexOf("contests");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Please sign in to enter." }, ctx.requestId, 401, ctx.startedAt);
  const slug = slugFromPath(ctx.path);
  const body = (await req.json().catch(() => null)) as { accountId?: unknown; alias?: unknown } | null;
  if (!slug || typeof body?.accountId !== "string") return ApiResponse.error({ code: "VALIDATION", message: "accountId is required." }, ctx.requestId, 400, ctx.startedAt);
  const r = await enterContest(user.profile.id, slug, body.accountId, body.alias);
  if (!r.ok) {
    const status = r.code === "NOT_FOUND" ? 404 : r.code === "ALREADY" || r.code === "ALIAS_TAKEN" ? 409 : 422;
    return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, status, ctx.startedAt);
  }
  return ApiResponse.success({ entered: true }, ctx.requestId, 201, ctx.startedAt);
});
