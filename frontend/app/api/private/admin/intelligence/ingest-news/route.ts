// app/api/private/admin/intelligence/ingest-news/route.ts
// AN1.2/AN1.6 - the ONE scheduled trigger for real news ingestion,
// following evaluate-outcomes/route.ts's exact precedent: a trusted
// scheduler (Vercel Cron, presenting `Authorization: Bearer <cron secret>`)
// OR an authenticated admin, both calling the same
// runScheduledIngestion() - never a plain logged-in trader. GET is Vercel
// Cron's only supported invocation method; POST is kept for any existing
// non-Vercel caller already configured to POST here.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { runScheduledIngestion } from "@/services/news/ingestion.service";

export const maxDuration = 60;

async function handleIngestionTrigger(req: Request, ctx: { requestId: string; startedAt: number }) {
  if (isValidCronSecret(req)) {
    const results = await runScheduledIngestion();
    return ApiResponse.success({ trigger: "cron", results }, ctx.requestId, 200, ctx.startedAt);
  }

  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const results = await runScheduledIngestion();
  return ApiResponse.success({ trigger: "admin-manual", results }, ctx.requestId, 200, ctx.startedAt);
}

export const GET = withContext(handleIngestionTrigger);
export const POST = withContext(handleIngestionTrigger);
