// app/api/private/admin/contests/[slug]/finalize/route.ts
// Admin: POST -> freeze the standings, pick the top 3 eligible entrants and issue their prize licences. Idempotent.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { finalizeContest } from "@/services/contest/contestService";
import { auditLogService } from "@/services/admin/AuditLogService";

function slugFromPath(path: string): string | undefined {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  const idx = segments.indexOf("contests");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const slug = slugFromPath(ctx.path);
  if (!slug) return ApiResponse.error({ code: "VALIDATION", message: "slug is required" }, ctx.requestId, 400, ctx.startedAt);
  const r = await finalizeContest(slug);
  if ("error" in r) return ApiResponse.error({ code: "CONFLICT", message: r.error }, ctx.requestId, 409, ctx.startedAt);
  if (!r.alreadyFinalized) {
    await auditLogService
      .record({ actorUserId: gate.user.profile.id, action: "contest.finalized", targetType: "contest", targetId: r.contestId, metadata: { winners: r.winners.map((w) => ({ rank: w.rank, alias: w.alias, licenseId: w.licenseId })) } })
      .catch(() => undefined);
  }
  return ApiResponse.success(r, ctx.requestId, 200, ctx.startedAt);
});
