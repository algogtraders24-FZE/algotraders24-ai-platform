// services/admin/AuditLogService.ts
// Sprint L2.6 - Phase 7: real, persisted audit trail for every admin
// action. Append-only by design (see the AuditLog Prisma model comment) -
// this service exposes record() and list()/count() only, deliberately no
// update/delete. Every admin mutation in this sprint (role/status changes,
// subscription overrides, knowledge moderation) calls record() with the
// real before/after values, never a synthesized summary.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

export type AuditAction =
  | "user.role_changed"
  | "user.status_changed"
  | "subscription.plan_overridden"
  | "subscription.canceled"
  | "subscription.reactivated"
  | "knowledge.deleted"
  // Sprint M9 - Marketplace Product Factory audit trail. Reuses this
  // existing, already-append-only AuditLog model rather than a new table
  // (see ea-research/marketplace-research/m9-product-factory/
  // M9_architecture_audit.md section 5).
  | "marketplace.submission_created"
  | "marketplace.submission_updated"
  | "marketplace.submitted_for_review"
  | "marketplace.ingestion_started"
  | "marketplace.ingestion_completed"
  | "marketplace.validation_completed"
  | "marketplace.risk_analysis_completed"
  | "marketplace.trust_evaluated"
  | "marketplace.eligibility_evaluated"
  | "marketplace.published"
  | "marketplace.unpublished"
  | "marketplace.rejected";

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
}

function toEntry(row: {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}): AuditLogEntry {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class AuditLogService {
  async record(params: {
    actorUserId: string;
    action: AuditAction;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(params: { page: number; pageSize: number; action?: string; actorUserId?: string }): Promise<AuditLogPage> {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(100, Math.max(1, params.pageSize));
    const where = {
      ...(params.action ? { action: params.action } : {}),
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items: rows.map(toEntry), total };
  }
}

export const auditLogService = new AuditLogService();
