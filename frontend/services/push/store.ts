// services/push/store.ts
// Persistence interface for AT24 Web Push (so the logic is tested with an in-memory fake) and its Prisma implementation.

import { MAX_SUBSCRIPTIONS_PER_USER, type ValidSubscription } from "./subscription";

export interface SubRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  alertsOn: boolean;
  watchOn: boolean;
  failures: number;
  createdAt: Date;
}

export interface PushStore {
  /** Saves (or re-assigns to this user) a device subscription. Keeps at most MAX_SUBSCRIPTIONS_PER_USER per user: the oldest are dropped. */
  upsert(userId: string, sub: ValidSubscription, userAgent: string | null): Promise<void>;
  listByUser(userId: string): Promise<SubRow[]>;
  removeByEndpoint(userId: string, endpoint: string): Promise<boolean>;
  /** Used by the delivery path when a push service says the subscription is gone (404/410): no user check needed. */
  removeById(id: string): Promise<void>;
  setPrefs(userId: string, endpoint: string, prefs: { alertsOn?: boolean; watchOn?: boolean }): Promise<boolean>;
  markSent(id: string, at: Date): Promise<void>;
  markFailed(id: string): Promise<void>;
}

export const MAX_FAILURES = 5;

export function prismaPushStore(): PushStore {
  const db = async () => (await import("@/lib/prisma")).prisma;
  return {
    async upsert(userId, sub, userAgent) {
      const prisma = await db();
      await prisma.pushSubscription.upsert({
        where: { endpoint: sub.endpoint },
        create: { userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent: userAgent?.slice(0, 200) ?? null },
        update: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: userAgent?.slice(0, 200) ?? null, failures: 0 },
      });
      const all = await prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (all.length > MAX_SUBSCRIPTIONS_PER_USER) await prisma.pushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_SUBSCRIPTIONS_PER_USER).map((r) => r.id) } } });
    },
    async listByUser(userId) {
      const prisma = await db();
      return prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_SUBSCRIPTIONS_PER_USER });
    },
    async removeByEndpoint(userId, endpoint) {
      const prisma = await db();
      return (await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } })).count > 0;
    },
    async removeById(id) {
      const prisma = await db();
      await prisma.pushSubscription.deleteMany({ where: { id } });
    },
    async setPrefs(userId, endpoint, prefs) {
      const prisma = await db();
      const data: { alertsOn?: boolean; watchOn?: boolean } = {};
      if (prefs.alertsOn !== undefined) data.alertsOn = prefs.alertsOn;
      if (prefs.watchOn !== undefined) data.watchOn = prefs.watchOn;
      return (await prisma.pushSubscription.updateMany({ where: { userId, endpoint }, data })).count > 0;
    },
    async markSent(id, at) {
      const prisma = await db();
      await prisma.pushSubscription.updateMany({ where: { id }, data: { lastSentAt: at, failures: 0 } });
    },
    async markFailed(id) {
      const prisma = await db();
      await prisma.pushSubscription.updateMany({ where: { id }, data: { failures: { increment: 1 } } });
    },
  };
}
