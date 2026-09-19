// services/support/handoff-service.ts
// AT24 Support Human Handoff MVP - the ONE canonical service/domain layer
// for AT24's first internal Support Ticket/Case system
// (SUPPORT_HUMAN_HANDOFF_ARCHITECTURE_LOCK.md). Every route (user-facing
// and admin-facing) calls into this file - never a second, competing
// creation/transition function anywhere else (owner's own instruction,
// implementation sprint section 7/21).
//
// AUTHORITY BOUNDARY (D3, locked): this file NEVER decides whether
// something needs a human. It only consumes the escalation decision
// support.specialist.ts already made (escalate/escalationReason on the
// AgentRun's own output) or a user's explicit request - it never
// re-scores, re-derives, or overrides that decision.
//
// SECURITY BOUNDARY (§18): every function here either takes an
// already-authorization-checked actor identity from its caller (the route
// must call getUserOrNull()/requireAdmin() FIRST) or performs its own
// ownership check via handoffRepository's userId-scoped reads. No function
// here trusts a client-supplied userId/adminUserId for anything but display.
import {
  handoffRepository,
  DuplicateActiveHandoffError,
  type SupportHandoffRow,
  type SupportHandoffRecord,
} from "./handoff.repository";
import { agentRunRepository } from "@/services/agent-framework/runtime/agent-run.repository";
import { auditLogService } from "@/services/admin/AuditLogService";
import type {
  SupportHandoffStatus,
  SupportHandoffTriggerSource,
} from "@/lib/generated/prisma/enums";

export const USER_REQUEST_REASON = "user-requested";

export class NoConversationRunsError extends Error {
  constructor(conversationId: string) {
    super(`conversation "${conversationId}" has no prior Support runs to anchor a handoff to`);
    this.name = "NoConversationRunsError";
  }
}

export class HandoffNotFoundError extends Error {
  constructor(id: string) {
    super(`SupportHandoff "${id}" not found (or not owned by the caller)`);
    this.name = "HandoffNotFoundError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`SupportHandoff cannot transition from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

export class HandoffNotActiveError extends Error {
  constructor(id: string, status: string) {
    super(`SupportHandoff "${id}" is not active (status: ${status}) - new messages must go through the normal Support pipeline`);
    this.name = "HandoffNotActiveError";
  }
}

/** D11 - the exact set a widget/hook must check before deciding whether a
 *  new user message goes to this handoff or to a fresh AgentRun. */
export function isHandoffActive(status: SupportHandoffStatus): boolean {
  return status === "OPEN" || status === "ASSIGNED" || status === "IN_PROGRESS";
}

async function gatherEvidenceIds(agentRunId: string): Promise<string[]> {
  const trace = await agentRunRepository.getRunTrace(agentRunId);
  return trace.evidence
    .filter((e) => e.source.startsWith("support-kb:") || e.source.startsWith("account:") || e.source.startsWith("support-generated:"))
    .map((e) => e.id);
}

/** The ONE canonical creation/reuse function (D1, D2, D3, D7). Called from
 *  two places only: agent-run-service.ts's advanceAgentRun() hook
 *  (triggerSource: "AI_ESCALATION", agentRunId supplied - the exact run
 *  that escalated) and the user-facing "Talk to a human" route
 *  (triggerSource: "USER_REQUEST", agentRunId omitted - resolved here from
 *  the conversation's own latest run, never trusted from the client).
 *
 *  Race-safe (D1's exact requirement): checks for an existing active
 *  handoff first (the fast path for the overwhelmingly common case), and
 *  falls back to re-reading after a DuplicateActiveHandoffError from the
 *  repository's own DB-level partial unique index if two concurrent calls
 *  raced past the check - never a lost update, never a duplicate row. */
export async function ensureSupportHandoff(params: {
  userId: string;
  conversationId: string;
  triggerSource: SupportHandoffTriggerSource;
  reason: string;
  /** AI_ESCALATION only - the exact run whose synthesize() set
   *  escalate:true. Omit for USER_REQUEST; the latest run in the
   *  conversation is resolved server-side instead. */
  agentRunId?: string;
}): Promise<SupportHandoffRecord> {
  const existing = await handoffRepository.findActiveForUserConversation(params.userId, params.conversationId);
  if (existing) return existing;

  let agentRunId = params.agentRunId;
  if (!agentRunId) {
    const priorRuns = await agentRunRepository.listRunsForConversation(params.userId, params.conversationId, 50);
    const latest = priorRuns[priorRuns.length - 1];
    if (!latest) throw new NoConversationRunsError(params.conversationId);
    agentRunId = latest.id;
  }

  const evidenceIds = await gatherEvidenceIds(agentRunId);

  try {
    const created = await handoffRepository.create({
      userId: params.userId,
      conversationId: params.conversationId,
      agentRunId,
      triggerSource: params.triggerSource,
      reason: params.reason,
      evidenceIds,
    });
    await auditLogService.record({
      actorUserId: params.userId,
      action: "support_handoff.created",
      targetType: "SupportHandoff",
      targetId: created.id,
      metadata: { triggerSource: params.triggerSource, conversationId: params.conversationId },
    });
    return created;
  } catch (err) {
    if (err instanceof DuplicateActiveHandoffError) {
      const nowExisting = await handoffRepository.findActiveForUserConversation(params.userId, params.conversationId);
      if (nowExisting) return nowExisting;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// User-facing reads (safe shape only - never agentRunId/evidenceIds/
// assignedAdminUserId, per §20's "do not expose internal database IDs").
// ---------------------------------------------------------------------

export interface UserFacingHandoff {
  id: string;
  status: SupportHandoffStatus;
  createdAt: string;
  resolvedAt: string | null;
  messages: { id: string; authorType: string; content: string; createdAt: string }[];
}

function toUserFacing(row: NonNullable<SupportHandoffRow>, messages: { id: string; authorType: string; content: string; createdAt: Date }[]): UserFacingHandoff {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    messages: messages.map((m) => ({ id: m.id, authorType: m.authorType, content: m.content, createdAt: m.createdAt.toISOString() })),
  };
}

/** The active handoff (if any) for the caller's own conversation - lets the
 *  widget know whether to switch into "handed to support" mode. Null is a
 *  normal, expected result (no active handoff), not an error. */
export async function getActiveHandoffForUserConversation(userId: string, conversationId: string): Promise<UserFacingHandoff | null> {
  const row = await handoffRepository.findActiveForUserConversation(userId, conversationId);
  if (!row) return null;
  const messages = await handoffRepository.listMessages(row.id);
  return toUserFacing(row, messages);
}

export async function getSupportHandoffForUser(id: string, userId: string): Promise<UserFacingHandoff> {
  const row = await handoffRepository.getForUser(id, userId);
  if (!row) throw new HandoffNotFoundError(id);
  const messages = await handoffRepository.listMessages(row.id);
  return toUserFacing(row, messages);
}

/** D11: a new user message while the handoff is active goes here, NOT
 *  through a new AgentRun. Rejects (HandoffNotActiveError) once terminal -
 *  the caller (the widget/hook) is responsible for routing a terminal
 *  conversation's next message back through the normal ask() flow instead;
 *  this function's own check is the server-side backstop, not the only
 *  gate. */
export async function replyAsSupportUser(id: string, userId: string, content: string): Promise<UserFacingHandoff> {
  const row = await handoffRepository.getForUser(id, userId);
  if (!row) throw new HandoffNotFoundError(id);
  if (!isHandoffActive(row.status)) throw new HandoffNotActiveError(id, row.status);

  await handoffRepository.appendMessage({ handoffId: id, authorType: "USER", authorUserId: userId, content });
  const messages = await handoffRepository.listMessages(id);
  return toUserFacing(row, messages);
}

/** §18: User = YES for Reopen, own handoff only, RESOLVED -> OPEN exactly -
 *  no other transition is ever permitted through this function. */
export async function reopenSupportHandoffAsUser(id: string, userId: string): Promise<UserFacingHandoff> {
  const row = await handoffRepository.getForUser(id, userId);
  if (!row) throw new HandoffNotFoundError(id);
  if (row.status !== "RESOLVED") throw new InvalidTransitionError(row.status, "OPEN");

  const updated = await handoffRepository.patch(id, { status: "OPEN", resolvedAt: null });
  await auditLogService.record({
    actorUserId: userId,
    action: "support_handoff.reopened",
    targetType: "SupportHandoff",
    targetId: id,
    metadata: { from: "RESOLVED", to: "OPEN", actor: "user" },
  });
  const messages = await handoffRepository.listMessages(id);
  return toUserFacing(updated, messages);
}

// ---------------------------------------------------------------------
// Admin-facing reads/writes. Every function assumes the CALLER already
// verified requireAdmin() - these functions never re-derive admin status
// themselves (that would duplicate lib/auth/adminRoute.ts's own gate).
// ---------------------------------------------------------------------

export interface AdminQueueEntry {
  id: string;
  userId: string;
  conversationId: string;
  status: SupportHandoffStatus;
  triggerSource: SupportHandoffTriggerSource;
  reason: string;
  assignedAdminUserId: string | null;
  createdAt: string;
}

export async function listSupportHandoffsForAdmin(params: {
  status?: SupportHandoffStatus;
  page: number;
  pageSize: number;
}): Promise<{ items: AdminQueueEntry[]; total: number }> {
  const { rows, total } = await handoffRepository.listForAdmin(params);
  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      conversationId: r.conversationId,
      status: r.status,
      triggerSource: r.triggerSource,
      reason: r.reason,
      assignedAdminUserId: r.assignedAdminUserId,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}

export interface AdminHandoffDetail {
  id: string;
  userId: string;
  conversationId: string;
  agentRunId: string;
  status: SupportHandoffStatus;
  triggerSource: SupportHandoffTriggerSource;
  reason: string;
  assignedAdminUserId: string | null;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  messages: { id: string; authorType: string; authorUserId: string | null; content: string; createdAt: string }[];
  /** The live conversation trace (D6 - re-fetched, never duplicated).
   *  Un-redacted for account-context, deliberately (D6/D13's own reversal
   *  of Phase B's LLM-facing redaction rule - a real human agent needs the
   *  real account facts to help, never fabricated, never hidden from
   *  staff). */
  conversationTurns: {
    runId: string;
    question: string;
    coverage: string | null;
    escalate: boolean;
    generatedAnswer: string | null;
    /** Real, retrieved KB citation claim text (never fabricated) - §14
     *  "Evidence: relevant AgentEvidence references where applicable". */
    citations: { topic: string; claim: string }[];
    /** Real, retrieved account findings, UN-redacted (D6/D13's own
     *  deliberate reversal of Phase B's LLM-facing redaction) - §14
     *  "Account Context: only authorized, support-relevant account
     *  information", never an unrestricted account dump (only what THIS
     *  run's own support.account_read tool actually retrieved). */
    accountFindings: { domain: string; claim: string }[];
    createdAt: string;
  }[];
}

export async function getSupportHandoffDetailForAdmin(id: string): Promise<AdminHandoffDetail> {
  const row = await handoffRepository.getById(id);
  if (!row) throw new HandoffNotFoundError(id);

  const [messages, conversationRuns] = await Promise.all([
    handoffRepository.listMessages(id),
    agentRunRepository.listRunsForConversation(row.userId, row.conversationId, 50),
  ]);

  const conversationTurns = await Promise.all(
    conversationRuns.map(async (r) => {
      const input = (r.input ?? {}) as { question?: unknown };
      const output = (r.output ?? {}) as {
        coverage?: string;
        escalate?: boolean;
        generatedAnswer?: string;
        citations?: { evidenceId: string; topic?: string }[];
        accountFindings?: { evidenceId: string; domain?: string }[];
      };
      const trace = await agentRunRepository.getRunTrace(r.id);
      const evById = new Map(trace.evidence.map((e) => [e.id, e]));
      const citations = (output.citations ?? [])
        .map((c) => ({ topic: c.topic ?? "support", claim: evById.get(c.evidenceId)?.claim ?? "" }))
        .filter((c) => c.claim);
      const accountFindings = (output.accountFindings ?? [])
        .map((f) => ({ domain: f.domain ?? "account", claim: evById.get(f.evidenceId)?.claim ?? "" }))
        .filter((f) => f.claim);
      return {
        runId: r.id,
        question: typeof input.question === "string" ? input.question : "",
        coverage: output.coverage ?? null,
        escalate: output.escalate === true,
        generatedAnswer: typeof output.generatedAnswer === "string" ? output.generatedAnswer : null,
        citations,
        accountFindings,
        createdAt: r.createdAt.toISOString(),
      };
    }),
  );

  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    agentRunId: row.agentRunId,
    status: row.status,
    triggerSource: row.triggerSource,
    reason: row.reason,
    assignedAdminUserId: row.assignedAdminUserId,
    evidenceIds: row.evidenceIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    messages: messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorUserId: m.authorUserId,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    conversationTurns,
  };
}

/** D5: OPEN receiving assignment transitions to ASSIGNED (the transition IS
 *  the assignment). Re-assigning an already-ASSIGNED/IN_PROGRESS case only
 *  updates assignedAdminUserId - status is unchanged (D4's own "what
 *  happens when an IN_PROGRESS case is reassigned" answer). No assignment
 *  is permitted on a terminal (RESOLVED/CANCELLED) handoff - nothing in the
 *  locked lifecycle describes assigning a closed case. */
export async function assignSupportHandoff(params: {
  id: string;
  targetAdminUserId: string;
  actingAdminUserId: string;
}): Promise<SupportHandoffRecord> {
  const row = await handoffRepository.getById(params.id);
  if (!row) throw new HandoffNotFoundError(params.id);
  if (row.status === "RESOLVED" || row.status === "CANCELLED") {
    throw new InvalidTransitionError(row.status, "ASSIGNED");
  }

  const isReassignment = row.status === "ASSIGNED" || row.status === "IN_PROGRESS";
  const updated = await handoffRepository.patch(params.id, {
    assignedAdminUserId: params.targetAdminUserId,
    ...(row.status === "OPEN" ? { status: "ASSIGNED" as SupportHandoffStatus } : {}),
  });

  await auditLogService.record({
    actorUserId: params.actingAdminUserId,
    action: isReassignment ? "support_handoff.reassigned" : "support_handoff.assigned",
    targetType: "SupportHandoff",
    targetId: params.id,
    metadata: { targetAdminUserId: params.targetAdminUserId, previousStatus: row.status },
  });

  return updated;
}

/** The locked D4 transition matrix, exactly as given - no additional
 *  transition invented (e.g. ASSIGNED -> RESOLVED directly is deliberately
 *  NOT included; the Architecture Lock left "may a transition skip an
 *  intermediate state" as UNKNOWN - REQUIRES DECISION, §21, so this stays
 *  strict rather than guessing). */
const ADMIN_TRANSITIONS: Record<SupportHandoffStatus, SupportHandoffStatus[]> = {
  OPEN: ["CANCELLED"], // OPEN -> ASSIGNED happens only via assignSupportHandoff, never a bare transition call
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["RESOLVED", "CANCELLED"],
  RESOLVED: ["OPEN"], // reopen - also reachable by the user via reopenSupportHandoffAsUser
  CANCELLED: [],
};

/** Admin-driven status transitions only (D4). The route calling this MUST
 *  have already verified requireAdmin() - this function does not. */
export async function transitionSupportHandoffAsAdmin(params: {
  id: string;
  toStatus: SupportHandoffStatus;
  actingAdminUserId: string;
}): Promise<SupportHandoffRecord> {
  const row = await handoffRepository.getById(params.id);
  if (!row) throw new HandoffNotFoundError(params.id);

  const allowed = ADMIN_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(params.toStatus)) {
    throw new InvalidTransitionError(row.status, params.toStatus);
  }

  const updated = await handoffRepository.patch(params.id, {
    status: params.toStatus,
    resolvedAt: params.toStatus === "RESOLVED" ? new Date() : params.toStatus === "OPEN" ? null : undefined,
  });

  await auditLogService.record({
    actorUserId: params.actingAdminUserId,
    action: params.toStatus === "OPEN" ? "support_handoff.reopened" : "support_handoff.status_changed",
    targetType: "SupportHandoff",
    targetId: params.id,
    metadata: { from: row.status, to: params.toStatus },
  });

  return updated;
}

export async function replyAsSupportAdmin(params: {
  id: string;
  adminUserId: string;
  content: string;
}): Promise<AdminHandoffDetail> {
  const row = await handoffRepository.getById(params.id);
  if (!row) throw new HandoffNotFoundError(params.id);

  await handoffRepository.appendMessage({
    handoffId: params.id,
    authorType: "HUMAN",
    authorUserId: params.adminUserId,
    content: params.content,
  });
  await auditLogService.record({
    actorUserId: params.adminUserId,
    action: "support_handoff.human_reply_added",
    targetType: "SupportHandoff",
    targetId: params.id,
  });

  return getSupportHandoffDetailForAdmin(params.id);
}
