// app/api/private/publishing/dispatch/route.ts
// AT24 Publishing Engine (P2.3-E) - the dispatcher trigger.
//
// Runs one bounded batch of due publishing jobs (PENDING + auto-retryable
// FAILED) through PublishingService.dispatch(). PRIVILEGED: a valid cron
// secret OR an authenticated admin - never a plain logged-in user. Exact
// same auth shape as app/api/private/admin/intelligence/ingest-news.
//
// P2.3 builds this execution path; P2.4 wires the actual daily schedule
// (Vercel Hobby = one cron/day) and any preset-slot semantics. There is NO
// vercel.json cron entry in this sprint.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { publishingService } from "@/services/publishing/publishing.service";

export const maxDuration = 60;

async function handleDispatch(req: Request, ctx: { requestId: string; startedAt: number }) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  if (isValidCronSecret(req)) {
    const report = await publishingService.dispatch({ limit });
    return ApiResponse.success({ trigger: "cron", ...report }, ctx.requestId, 200, ctx.startedAt);
  }

  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const report = await publishingService.dispatch({ limit });
  return ApiResponse.success({ trigger: "admin-manual", ...report }, ctx.requestId, 200, ctx.startedAt);
}

// GET is Vercel Cron's only invocation method; POST kept for any other caller.
export const GET = withContext(handleDispatch);
export const POST = withContext(handleDispatch);
