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
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { createTelegramClient } from "@/services/telegram/client";
import { prismaTelegramStore } from "@/services/telegram/store";
import { telegramConfig } from "@/services/telegram/config";
import { buildSeo } from "@/services/ai/publishing/seo.service";
import { BRIEF_MARKETS, briefEnabledFor, buildDailyBrief, loadBriefAssets } from "@/lib/publishing/brief/brief-pipeline";
import { buildCalendarBrief, buildFundamentalBrief, eventsForSymbol, buildWeeklyBrief, type WeeklyPart } from "@/lib/publishing/brief/report-builders";
import { DailyAutoPublisherService, blogGroupMessage, dailyRunTelegramMessage, toPlainText } from "@/services/publishing/daily-auto-publisher.service";

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
  let eventsMemo: Awaited<ReturnType<typeof getEconomicCalendar>>["events"] | null = null;
  const getEvents = async () => (eventsMemo ??= (await getEconomicCalendar({ week: "this" })).events);
  const briefOn = (process.env.BRIEF_V2 ?? "").trim().toLowerCase() === "on";
  const service = new DailyAutoPublisherService({
    analyze: (symbol, question) => productionAnalysisOrchestrator.analyze({ userId: ownerId, symbol, question }),
    slugExists: async (slug) => (await prisma.article.findFirst({ where: { userId: ownerId, slug, deletedAt: null }, select: { id: true } })) !== null,
    createDraft: async (input) => {
      // A deleted draft (soft delete) still holds its slug under the (userId, slug) unique index, which would make today's report fail
      // to re-create. Rename the deleted rows' slug out of the way first (they stay deleted, nothing visible changes).
      const slug = buildSeo(input.custom.title, input.keywords).slug;
      const stale = await prisma.article.findMany({ where: { userId: ownerId, slug, deletedAt: { not: null } }, select: { id: true } });
      for (const row of stale) await prisma.article.update({ where: { id: row.id }, data: { slug: `${slug}-deleted-${row.id.slice(-6)}` } });
      return articleService.createDraft(ownerId, input);
    },
    publishNow: async (articleId) => {
      await publishingService.publishArticleNow(ownerId, articleId);
    },
    buildBrief: async (symbol) => (briefEnabledFor(symbol) ? buildDailyBrief(symbol, eventsForSymbol(symbol, await getEvents(), new Date())) : null),
    brief: briefOn
      ? {
          calendar: (date, events) => buildCalendarBrief(date, events),
          weekly: async (date, symbols) => {
            const parts: WeeklyPart[] = [];
            for (const symbol of symbols) {
              const a = await loadBriefAssets(symbol, []);
              if (a) parts.push({ label: BRIEF_MARKETS[symbol].displayName, facts: a.facts, chartUrl: a.chartUrl, week: a.week });
            }
            return buildWeeklyBrief(date, parts);
          },
          fundamental: async (symbol, outcome) => {
            if (!briefEnabledFor(symbol)) return null;
            const a = await loadBriefAssets(symbol, eventsForSymbol(symbol, await getEvents(), new Date()));
            if (!a) return null;
            const ex = outcome.result.explainable;
            return buildFundamentalBrief({
              facts: a.facts,
              chartUrl: a.chartUrl,
              overview: toPlainText(outcome.result.summary),
              supporting: ex.supportingEvidence.map((i) => toPlainText(i.text)).filter(Boolean),
              opposing: ex.opposingEvidence.map((i) => toPlainText(i.text)).filter(Boolean),
              unknown: ex.unknownFactors.map((u) => toPlainText(u)).filter(Boolean),
              risk: [ex.riskSummary, ex.confidenceSummary, ...ex.limitations.map((l) => `Limitation: ${l}`)].map((r) => toPlainText(r ?? "")).filter((r) => r.length > 0),
              events: a.facts.events,
            });
          },
        }
      : undefined,
    getCalendarEvents: getEvents,
  });
  const report = await service.run();
  // Owner-only summary to the Telegram chat linked on /dashboard/live-sync (best effort: never throws, never blocks).
  // No public channel post - that stays a separate, owner-approved step.
  if (report.results.length > 0) {
    await sendTelegramToUser(ownerId, "alerts", dailyRunTelegramMessage(report.results, telegramConfig().siteUrl));
  }
  await postToTelegramGroup(report.results);
  return report;
}

/**
 * Each newly published report goes once to the AT24 Telegram group/channel (TELEGRAM_CHANNEL_ID).
 * Dormant without a chat id; TELEGRAM_CHANNEL_BLOG=off turns it off; nothing is posted twice (kind "blog", refId = article id).
 * Best effort: a Telegram failure never affects publishing.
 */
async function postToTelegramGroup(results: Awaited<ReturnType<DailyAutoPublisherService["run"]>>["results"]): Promise<void> {
  try {
    const cfg = telegramConfig();
    if (!cfg.enabled || !cfg.channelId || (process.env.TELEGRAM_CHANNEL_BLOG ?? "").trim().toLowerCase() === "off") return;
    const store = prismaTelegramStore();
    const client = createTelegramClient(cfg.token);
    for (const r of results) {
      if (r.status !== "published" || !r.articleId) continue;
      if (await store.hasPosted("blog", r.articleId)) continue;
      const res = await client.sendMessage(cfg.channelId, blogGroupMessage(r.title, cfg.siteUrl), { preview: true });
      if (!res.ok) break; // do not hammer a failing chat
      await store.recordPost("blog", r.articleId, res.messageId ?? null);
    }
  } catch {
    /* best effort */
  }
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
