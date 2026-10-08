// services/notifications/NotificationService.ts
// The in-app notification feed (header bell). Every query is scoped to the user id.
import "server-only";
import { prisma } from "@/lib/prisma";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationRow {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: Date;
  readAt: Date | null;
}

const MAX_LIST = 30;

export async function createNotification(params: { userId: string; kind: string; severity?: NotificationSeverity; title: string; body?: string; href?: string }): Promise<void> {
  await prisma.userNotification.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      severity: params.severity ?? "info",
      title: params.title.slice(0, 160),
      body: (params.body ?? "").slice(0, 600),
      href: params.href ?? null,
    },
  });
}

export async function listNotifications(userId: string): Promise<{ items: NotificationRow[]; unread: number }> {
  const [items, unread] = await Promise.all([
    prisma.userNotification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_LIST }),
    prisma.userNotification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markAllRead(userId: string): Promise<number> {
  const r = await prisma.userNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return r.count;
}
