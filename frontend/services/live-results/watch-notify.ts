// services/live-results/watch-notify.ts
// Called by the 5-minute sweep: tells members who WATCH a public Live Results page (bell only) when it stopped
// reporting and when it is back. State is derived from the notification log itself (no extra table): the newest
// "stale"/"resumed" notification a member got for that page. Never throws.

import { prisma } from "@/lib/prisma";
import { createNotification } from "@/services/notifications/NotificationService";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { sendPushToUser } from "@/services/push/deliver";
import { alertMessage } from "@/services/telegram/messages";
import { telegramConfig } from "@/services/telegram/config";
import { liveResultsEnabled } from "./prisma-store";
import { watchDecision, watchMessage, WATCH_KIND_RESUMED, WATCH_KIND_STALE, type WatchKind } from "./watch-rules";

const MAX_FOLLOWS = 2000;
const MAX_NOTIFICATIONS_PER_SWEEP = 500;

export async function sweepWatchers(nowDate: Date = new Date()): Promise<{ watched: number; notified: number }> {
  if (!liveResultsEnabled()) return { watched: 0, notified: 0 };
  try {
    const now = nowDate.getTime();
    const follows = await prisma.liveResultsFollow.findMany({ take: MAX_FOLLOWS, select: { userId: true, pageId: true, createdAt: true } });
    if (follows.length === 0) return { watched: 0, notified: 0 };
    const pages = await prisma.liveResultsPage.findMany({ where: { id: { in: [...new Set(follows.map((f) => f.pageId))] }, visibility: "public" }, select: { id: true, slug: true, title: true, accountId: true, userId: true } });
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const accounts = await prisma.liveSyncAccount.findMany({ where: { id: { in: pages.map((p) => p.accountId) } }, select: { id: true, userId: true, lastSyncAt: true } });
    const lastSync = new Map(accounts.map((a) => [a.id + "|" + a.userId, a.lastSyncAt.getTime()]));

    let notified = 0;
    for (const f of follows) {
      if (notified >= MAX_NOTIFICATIONS_PER_SWEEP) break;
      const page = pageById.get(f.pageId);
      if (!page) continue;
      const lastAt = lastSync.get(page.accountId + "|" + page.userId);
      if (lastAt === undefined) continue;
      const href = `/results/${page.slug}`;
      const prev = await prisma.userNotification.findFirst({
        where: { userId: f.userId, href, kind: { in: [WATCH_KIND_STALE, WATCH_KIND_RESUMED] } },
        orderBy: { createdAt: "desc" },
        select: { kind: true, createdAt: true },
      });
      const action = watchDecision({
        followedAt: f.createdAt.getTime(),
        lastSyncAt: lastAt,
        nowUtc: now,
        last: prev ? { kind: prev.kind as WatchKind, at: prev.createdAt.getTime() } : null,
      });
      if (action === "none") continue;
      const msg = watchMessage(action, page.title, Math.max(1, Math.round((now - lastAt) / 60_000)));
      await createNotification({ userId: f.userId, kind: action === "stopped" ? WATCH_KIND_STALE : WATCH_KIND_RESUMED, severity: msg.severity, title: msg.title, body: msg.body, href }).catch(() => undefined);
      await sendTelegramToUser(f.userId, "watch", alertMessage({ title: msg.title, body: msg.body, href, siteUrl: telegramConfig().siteUrl })).catch(() => false);
      await sendPushToUser(f.userId, "watch", { title: msg.title, body: msg.body, url: href, tag: `watch-${page.slug}` }).catch(() => 0);
      notified++;
    }
    return { watched: follows.length, notified };
  } catch {
    return { watched: 0, notified: 0 };
  }
}
