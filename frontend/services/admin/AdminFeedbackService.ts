// services/admin/AdminFeedbackService.ts
// Sprint R1.2 - Phase 1: admin-facing review of user-submitted Feedback.
// list()/updateStatus() only - never edits a user's own message, and never
// deletes (no delete path exists anywhere in the app, matching AuditLog's
// and RequestLog's append-only-content discipline; status is the one field
// an admin may change, since "admin can review feedback" requires a real
// open -> reviewed -> resolved transition to be possible).
import { prisma } from "@/lib/prisma";

export type FeedbackStatus = "open" | "reviewed" | "resolved";
const VALID_STATUSES: readonly FeedbackStatus[] = ["open", "reviewed", "resolved"];

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

export interface AdminFeedbackEntry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: string;
  message: string;
  page: string;
  status: string;
  createdAt: string;
}

export interface AdminFeedbackPage {
  items: AdminFeedbackEntry[];
  total: number;
}

export interface FeedbackSummary {
  total: number;
  byStatus: Record<FeedbackStatus, number>;
  byType: Record<"bug" | "feature" | "general", number>;
}

export class AdminFeedbackService {
  async list(params: { page: number; pageSize: number; status?: string; type?: string }): Promise<AdminFeedbackPage> {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(100, Math.max(1, params.pageSize));
    const where = {
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { type: params.type } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.feedback.count({ where }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: userById.get(r.userId)?.name ?? "Unknown user",
        userEmail: userById.get(r.userId)?.email ?? "-",
        type: r.type,
        message: r.message,
        page: r.page,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  async updateStatus(id: string, status: FeedbackStatus): Promise<AdminFeedbackEntry | null> {
    const existing = await prisma.feedback.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return null;

    const updated = await prisma.feedback.update({ where: { id }, data: { status } });
    const user = await prisma.user.findUnique({ where: { id: updated.userId }, select: { name: true, email: true } });

    return {
      id: updated.id,
      userId: updated.userId,
      userName: user?.name ?? "Unknown user",
      userEmail: user?.email ?? "-",
      type: updated.type,
      message: updated.message,
      page: updated.page,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async summary(): Promise<FeedbackSummary> {
    const rows = await prisma.feedback.findMany({
      where: { deletedAt: null },
      select: { status: true, type: true },
    });

    const byStatus: Record<FeedbackStatus, number> = { open: 0, reviewed: 0, resolved: 0 };
    const byType: Record<"bug" | "feature" | "general", number> = { bug: 0, feature: 0, general: 0 };
    for (const row of rows) {
      if (isFeedbackStatus(row.status)) byStatus[row.status] += 1;
      if (row.type === "bug" || row.type === "feature" || row.type === "general") byType[row.type] += 1;
    }

    return { total: rows.length, byStatus, byType };
  }
}

export const adminFeedbackService = new AdminFeedbackService();
