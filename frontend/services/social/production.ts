// services/social/production.ts
// Production wiring for the social outbox: Prisma store, the market hub / scoreboard / blog sources, the Telegram channel photo
// sender and the optional automation webhook. Dormant per channel: with neither TELEGRAM_CHANNEL_ID (+ bot) nor SOCIAL_WEBHOOK_URL
// set, approved posts report "no channel configured" and nothing leaves the platform.
import "server-only";
import { prisma } from "@/lib/prisma";
import { MARKETS } from "@/services/markets/hub";
import { getMarketHub } from "@/services/markets/production";
import { readScoreboard } from "@/services/calibration/production";
import { blogReaderService } from "@/services/publishing/blog-reader.service";
import { telegramConfig } from "@/services/telegram/config";
import { createTelegramClient } from "@/services/telegram/client";
import { SITE_URL } from "@/lib/seo/seo";
import type { ChannelResults, DispatchDeps } from "./dispatch";
import { makeWebhookSender } from "./dispatch";
import { parseAutoApprove, runSocialWith, type SocialDeps, type SocialRunResult, type SocialStore } from "./runner";

export const prismaSocialStore: SocialStore = {
  async createIfNew(d, status) {
    try {
      await prisma.socialPost.create({
        data: { kind: d.kind, dedupeKey: d.dedupeKey, title: d.title, text: d.text, shortText: d.shortText, imagePath: d.imagePath, linkUrl: d.linkUrl, status, approvedAt: status === "APPROVED" ? new Date() : null },
      });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return false;
      throw e;
    }
  },
  async listApproved() {
    const rows = await prisma.socialPost.findMany({ where: { status: "APPROVED" }, orderBy: { createdAt: "asc" }, take: 10 });
    return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, text: r.text, shortText: r.shortText, imagePath: r.imagePath, linkUrl: r.linkUrl, attempts: r.attempts }));
  },
  async markSent(id, results: ChannelResults) {
    await prisma.socialPost.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), results, error: null, attempts: { increment: 1 } } });
  },
  async markAttempt(id, results, error, final) {
    await prisma.socialPost.update({ where: { id }, data: { results, error, attempts: { increment: 1 }, ...(final ? { status: "FAILED" } : {}) } });
  },
};

export function productionDispatchDeps(): DispatchDeps {
  const tg = telegramConfig();
  const webhookUrl = (process.env.SOCIAL_WEBHOOK_URL ?? "").trim();
  const telegram = tg.enabled && tg.channelId ? createTelegramClient(tg.token) : null;
  return {
    siteUrl: SITE_URL,
    telegram: telegram ? async (photoUrl, caption) => telegram.sendPhoto(tg.channelId, photoUrl, caption) : null,
    webhook: webhookUrl ? makeWebhookSender(webhookUrl, (process.env.SOCIAL_WEBHOOK_SECRET ?? "").trim() || undefined) : null,
  };
}

export function productionDeps(): SocialDeps {
  return {
    store: prismaSocialStore,
    siteUrl: SITE_URL,
    autoApprove: parseAutoApprove(process.env.SOCIAL_AUTO_APPROVE),
    dispatch: productionDispatchDeps(),
    sources: {
      hubs: () => Promise.all(MARKETS.map((m) => getMarketHub(m))),
      scoreboard: async () => (await readScoreboard()).all,
      recentPosts: async () => (await blogReaderService.listPosts()).map((p) => ({ slug: p.slug, title: p.title, excerpt: p.excerpt, publishedAt: p.publishedAt ?? null })),
    },
  };
}

export function runSocial(now: Date = new Date()): Promise<SocialRunResult> {
  return runSocialWith(productionDeps(), now);
}
