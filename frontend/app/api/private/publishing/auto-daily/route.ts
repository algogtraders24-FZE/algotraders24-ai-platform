// app/api/private/publishing/auto-daily/route.ts
// AT24 Publishing - the daily auto-publish trigger (one Vercel Cron per day).
//
// Writes the day's market reports (see services/publishing/daily-auto-publisher
// .service.ts) and publishes them to /blog through the Publishing Engine.
// PRIVILEGED: a valid cron secret OR an authenticated admin - same gate as
// ../dispatch. Articles are owned by PUBLISHING_AUTO_USER_ID when set, else the
// oldest admin account.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { prisma } from "@/lib/prisma";
import { articleService } from "@/services/publishing/article.service";
import { publishingService } from "@/services/publishing/publishing.service";
import { productionAnalysisOrchestrator } from "@/services/ai/production-analysis-orchestrator";
import { getEconomicCalendar } from "@/services/calendar/calendar.service";
import { DailyAutoPublisherService } from "@/services/publishing/daily-auto-publisher.service";

// Up to ~6 sequential live-data + AI analyses (Sunday weekly review = 3, plus the daily crypto report).
export const maxDuration = 300;

async function resolveOwnerId(): Promise<string> {
  const configured = process.env.PUBLISHING_AUTO_USER_ID?.trim();
  if (configured) return configured;
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!admin) throw Errors.notFound("Publishing owner (set PUBLISHING_AUTO_USER_ID or create an admin user)");
  return admin.id;
}

async function runDaily(): Promise<Awaited<ReturnType<DailyAutoPublisherService["run"]>>> {
  const ownerId = await resolveOwnerId();
  const service = new DailyAutoPublisherService({
    analyze: (symbol, question) => productionAnalysisOrchestrator.analyze({ userId: ownerId, symbol, question }),
    slugExists: async (slug) => (await prisma.article.findFirst({ where: { userId: ownerId, slug, deletedAt: null }, select: { id: true } })) !== null,
    createDraft: (input) => articleService.createDraft(ownerId, input),
    publishNow: async (articleId) => {
      await publishingService.publishArticleNow(ownerId, articleId);
    },
    getCalendarEvents: async () => (await getEconomicCalendar({ week: "this" })).events,
  });
  return service.run();
}

async function handleAutoDaily(req: Request, ctx: { requestId: string; startedAt: number }) {
  if (isValidCronSecret(req)) {
    const report = await runDaily();
    return ApiResponse.success({ trigger: "cron", ...report }, ctx.requestId, 200, ctx.startedAt);
  }

  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const report = await runDaily();
  return ApiResponse.success({ trigger: "admin-manual", ...report }, ctx.requestId, 200, ctx.startedAt);
}

// GET is Vercel Cron's only invocation method; POST kept for the manual admin trigger.
export const GET = withContext(handleAutoDaily);
export const POST = withContext(handleAutoDaily);
