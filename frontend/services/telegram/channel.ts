// services/telegram/channel.ts
// AT24's OWN Telegram channel: automatic, neutral announcements.
//   - new marketplace listings (default: only AT24's own, i.e. listings whose seller is an admin; TELEGRAM_CHANNEL_ANNOUNCE=all/off)
//   - an optional weekly digest of PUBLIC Live Results pages (OFF unless TELEGRAM_CHANNEL_DIGEST=on): percent only, drawdown next to gain
// Each post is recorded (kind, refId) so nothing is announced twice. Never throws; dormant without a channel id.
// The digest shows performance numbers in public, so it stays off until the owner has the lawyer's answer on public performance display.

import { telegramConfig, type AnnounceMode } from "./config";
import { createTelegramClient, type TelegramClient } from "./client";
import { digestMessage, listingAnnouncement, priceText, type DigestRow } from "./messages";
import { prismaTelegramStore, type TelegramStore } from "./store";

export interface AnnounceListing {
  id: string;
  slug: string;
  title: string;
  pricing: unknown;
  platformTag: string;
  assetTag: string;
  sellerIsAdmin: boolean;
}

export interface ChannelDeps {
  store: TelegramStore;
  client: TelegramClient;
  channelId: string;
  siteUrl: string;
  announce: AnnounceMode;
  digestOn: boolean;
  /** Listings published in the recent window, newest first. */
  recentListings: () => Promise<AnnounceListing[]>;
  /** Public Live Results summaries (percent only). */
  digestRows: () => Promise<(DigestRow & { enoughData: boolean })[]>;
  now?: () => Date;
}

const MAX_POSTS_PER_RUN = 3;

export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

export async function announceNewListings(deps: ChannelDeps): Promise<{ posted: number; skipped: number }> {
  try {
    if (!deps.channelId || deps.announce === "off") return { posted: 0, skipped: 0 };
    const listings = await deps.recentListings();
    let posted = 0;
    let skipped = 0;
    for (const l of listings) {
      if (posted >= MAX_POSTS_PER_RUN) break;
      if (deps.announce === "admin" && !l.sellerIsAdmin) {
        skipped++;
        continue;
      }
      if (await deps.store.hasPosted("listing", l.id)) continue;
      const res = await deps.client.sendMessage(deps.channelId, listingAnnouncement({ title: l.title, slug: l.slug, priceText: priceText(l.pricing), platform: l.platformTag, asset: l.assetTag }, deps.siteUrl));
      if (!res.ok) break; // do not hammer a failing channel; the next run retries
      await deps.store.recordPost("listing", l.id, res.messageId ?? null);
      posted++;
    }
    return { posted, skipped };
  } catch {
    return { posted: 0, skipped: 0 };
  }
}

/** Once per ISO week, only when the owner switched the digest on and at least one public page has enough trades to judge. */
export async function postWeeklyDigest(deps: ChannelDeps): Promise<boolean> {
  try {
    if (!deps.channelId || !deps.digestOn) return false;
    const now = (deps.now ?? (() => new Date()))();
    const week = isoWeekKey(now);
    if (await deps.store.hasPosted("digest", week)) return false;
    const rows = (await deps.digestRows()).filter((r) => r.enoughData);
    if (rows.length === 0) return false;
    const res = await deps.client.sendMessage(deps.channelId, digestMessage(rows, deps.siteUrl, week));
    if (!res.ok) return false;
    await deps.store.recordPost("digest", week, res.messageId ?? null);
    return true;
  } catch {
    return false;
  }
}

/** The production wiring: real store, real client, listings and summaries from the database. */
export async function productionChannelDeps(): Promise<ChannelDeps | null> {
  const cfg = telegramConfig();
  if (!cfg.enabled || !cfg.channelId) return null;
  const { prisma } = await import("@/lib/prisma");
  return {
    store: prismaTelegramStore(),
    client: createTelegramClient(cfg.token),
    channelId: cfg.channelId,
    siteUrl: cfg.siteUrl,
    announce: cfg.announce,
    digestOn: cfg.digestOn,
    async recentListings() {
      const rows = await prisma.marketplaceListing.findMany({
        where: { publicationState: "PUBLISHED", deletedAt: null, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, slug: true, title: true, pricing: true, platformTag: true, assetTag: true, sellerId: true },
      });
      if (rows.length === 0) return [];
      const admins = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sellerId))] }, role: "admin" }, select: { id: true } });
      const adminIds = new Set(admins.map((a) => a.id));
      return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, pricing: r.pricing, platformTag: r.platformTag, assetTag: r.assetTag, sellerIsAdmin: adminIds.has(r.sellerId) }));
    },
    async digestRows() {
      const { listPublicSummaries } = await import("@/services/live-results/prisma-store");
      return (await listPublicSummaries()).map((s) => ({ title: s.title, slug: s.slug, trades: s.trades, gainPct: s.gainPct, maxDrawdownPct: s.maxDrawdownPct, monthlyPct: s.monthlyPct, enoughData: s.enoughData }));
    },
  };
}
