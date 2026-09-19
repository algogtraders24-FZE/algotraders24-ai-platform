// services/support/handoff.repository.ts
// AT24 Support Human Handoff MVP - the ONLY module that reads/writes
// SupportHandoff / SupportHandoffMessage (SUPPORT_HUMAN_HANDOFF_ARCHITECTURE
// _LOCK.md), mirroring agentRunRepository's own locked-boundary convention
// (services/agent-framework/runtime/agent-run.repository.ts's own header
// comment: "The ONLY module that reads/writes..."). Pure data access - no
// authorization, no transition-matrix validation, no audit writes. Those
// live in handoff-service.ts, which is the ONLY caller of this file.
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  SupportHandoffStatus,
  SupportHandoffTriggerSource,
  SupportHandoffMessageAuthorType,
} from "@/lib/generated/prisma/enums";

/** The statuses D1's uniqueness invariant treats as "active" - the DB-level
 *  partial unique index (migration 20260919120000_add_support_handoff)
 *  encodes the SAME set; this constant exists only for the application-level
 *  check-first-then-create optimization (D1 - the fast path avoids hitting
 *  the DB constraint on every call; the constraint remains the true,
 *  race-safe backstop). */
export const ACTIVE_HANDOFF_STATUSES: readonly SupportHandoffStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS"];

export class DuplicateActiveHandoffError extends Error {
  constructor(conversationId: string) {
    super(`an active SupportHandoff already exists for conversation "${conversationId}"`);
    this.name = "DuplicateActiveHandoffError";
  }
}

export interface CreateHandoffInput {
  userId: string;
  conversationId: string;
  agentRunId: string;
  triggerSource: SupportHandoffTriggerSource;
  reason: string;
  evidenceIds: string[];
}

export const handoffRepository = {
  /** The active (OPEN/ASSIGNED/IN_PROGRESS) handoff for a conversation, if
   *  any - always userId-scoped (never a client-supplied one), matching
   *  agentRunRepository.getRunForUser's own ownership discipline. */
  async findActiveForUserConversation(userId: string, conversationId: string) {
    return prisma.supportHandoff.findFirst({
      where: { userId, conversationId, status: { in: ACTIVE_HANDOFF_STATUSES as SupportHandoffStatus[] } },
    });
  },

  /** Ownership-scoped read by id - the ONLY read primitive a user-facing
   *  route should use (never getRun-by-id-alone). */
  async getForUser(id: string, userId: string) {
    return prisma.supportHandoff.findFirst({ where: { id, userId } });
  },

  /** Admin read - no ownership scoping (an admin queue is cross-user by
   *  design, D1's whole reason for a new table); the caller (handoff-
   *  service.ts) must have already verified requireAdmin(). */
  async getById(id: string) {
    return prisma.supportHandoff.findUnique({ where: { id } });
  },

  /** Cross-user queue list for the admin surface (D12), optionally filtered
   *  by status. */
  async listForAdmin(params: { status?: SupportHandoffStatus; page: number; pageSize: number }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(100, Math.max(1, params.pageSize));
    const where = params.status ? { status: params.status } : {};
    const [rows, total] = await Promise.all([
      prisma.supportHandoff.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.supportHandoff.count({ where }),
    ]);
    return { rows, total };
  },

  /** Create a new handoff. Throws DuplicateActiveHandoffError if the DB's
   *  own partial unique index (D1) rejects a second active row for the same
   *  conversationId - the race-safe backstop behind handoff-service.ts's
   *  own check-first fast path. */
  async create(input: CreateHandoffInput) {
    try {
      return await prisma.supportHandoff.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          agentRunId: input.agentRunId,
          triggerSource: input.triggerSource,
          reason: input.reason,
          evidenceIds: input.evidenceIds,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new DuplicateActiveHandoffError(input.conversationId);
      }
      throw err;
    }
  },

  /** Narrow, explicit mutation - never a raw client PATCH of arbitrary
   *  fields (Architecture Lock D8's own security note on `status`). */
  async patch(
    id: string,
    patch: {
      status?: SupportHandoffStatus;
      assignedAdminUserId?: string | null;
      resolvedAt?: Date | null;
    },
  ) {
    return prisma.supportHandoff.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.assignedAdminUserId !== undefined ? { assignedAdminUserId: patch.assignedAdminUserId } : {}),
        ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
      },
    });
  },

  async listMessages(handoffId: string) {
    return prisma.supportHandoffMessage.findMany({
      where: { handoffId },
      orderBy: { createdAt: "asc" },
    });
  },

  async appendMessage(input: {
    handoffId: string;
    authorType: SupportHandoffMessageAuthorType;
    authorUserId: string | null;
    content: string;
  }) {
    return prisma.supportHandoffMessage.create({
      data: {
        handoffId: input.handoffId,
        authorType: input.authorType,
        authorUserId: input.authorUserId,
        content: input.content,
      },
    });
  },
};

export type SupportHandoffRow = Awaited<ReturnType<typeof handoffRepository.getById>>;
/** Non-null variant for functions that always return a real row or throw
 *  (create, patch) - never null in practice, unlike a plain findUnique. */
export type SupportHandoffRecord = NonNullable<SupportHandoffRow>;
