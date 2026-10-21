// app/api/private/admin/contests/[slug]/route.ts
// Admin: PATCH { status: "OPEN" | "CLOSED" } to open entries / close them. (FINALIZED is only set by .../finalize.)
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";

function slugFromPath(path: string): string | undefined {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  const idx = segments.indexOf("contests");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const slug = slugFromPath(ctx.path);
  const b = (await req.json().catch(() => null)) as { status?: unknown } | null;
  if (!slug || (b?.status !== "OPEN" && b?.status !== "CLOSED")) return ApiResponse.error({ code: "VALIDATION", message: 'status must be "OPEN" or "CLOSED".' }, ctx.requestId, 400, ctx.startedAt);
  const c = await prisma.contest.findUnique({ where: { slug } });
  if (!c) return ApiResponse.error({ code: "NOT_FOUND", message: "Contest not found" }, ctx.requestId, 404, ctx.startedAt);
  if (c.status === "FINALIZED") return ApiResponse.error({ code: "CONFLICT", message: "A finalized contest cannot be changed." }, ctx.requestId, 409, ctx.startedAt);
  const row = await prisma.contest.update({ where: { slug }, data: { status: b.status } });
  return ApiResponse.success({ contest: row }, ctx.requestId, 200, ctx.startedAt);
});
