// services/agent-framework/memory/memory-gateway.ts
// AT24 Agent Framework - A7. The ONE authority for agent memory access.
//
// LOCKED (owner G06):
//  - policy-gated: an agent can only touch a layer its MemoryPolicy grants;
//    default-deny where a layer isn't configured.
//  - scoped: reads are scoped to own / agent-type / user-global per the
//    layer's readPolicy.
//  - typed + provenance-aware + size-bounded + deterministic (contract
//    validators).
//  - auditable: every decision is logged and returned.
//  - RUN_STATE is NOT memory - it is rejected here (it lives on AgentRun).
//  - an agent must NEVER silently promote its own output into trusted
//    long-term knowledge: an `agent-derived` write to a knowledge layer is
//    forced to `pending_approval` (resolveWriteDecision), never `active`.

import {
  type MemoryPolicy,
  type MemoryReadQuery,
  type MemoryWriteRequest,
  type MemoryRetention,
  type MemoryLayer,
  MEMORY_KNOWLEDGE_LAYERS,
  resolveWriteDecision,
  validateMemoryWriteRequest,
} from "@/types/agent-framework";
import { logger } from "@/services/backend/Logger";
import type { MemoryStore, StoredMemoryRecord } from "./memory-store";
import { InMemoryStore } from "./in-memory-store";
import { PrismaMemoryStore } from "./prisma-memory-store";

const log = logger.child("agent-memory");

/** A memory record as returned to a caller - provenance kept, no internal ids leaked beyond `id`. */
export interface PublicMemoryRecord {
  id: string;
  layer: string;
  scope: string;
  key: string;
  value: unknown;
  origin: string;
  createdAt: string;
}

export interface MemoryAudit {
  at: string;
  op: "read" | "write" | "approve";
  decision: "allow" | "approval" | "deny";
  layer: string;
  scope: string;
  key?: string;
  agentId: string;
  userId: string;
  reason?: string;
}

export interface MemoryReadResult {
  allowed: boolean;
  records: PublicMemoryRecord[];
  reason?: string;
  audit: MemoryAudit;
}

export interface MemoryWriteResult {
  decision: "allow" | "approval" | "deny";
  status: "active" | "pending_approval" | "rejected";
  recordId?: string;
  reason?: string;
  audit: MemoryAudit;
}

function computeExpiry(retention: MemoryRetention | undefined, now: Date): string | null {
  if (!retention) return null;
  if (retention.mode === "ttl") return new Date(now.getTime() + retention.ttlDays * 86_400_000).toISOString();
  return null; // "run" / "persistent": no wall-clock expiry (run cleanup / never)
}

function toPublic(r: StoredMemoryRecord): PublicMemoryRecord {
  return { id: r.id, layer: r.layer, scope: r.scope, key: r.key, value: r.value, origin: r.provenance.origin, createdAt: r.createdAt };
}

export class MemoryGateway {
  private readonly store: MemoryStore;

  constructor(deps: { store?: MemoryStore } = {}) {
    this.store = deps.store ?? new InMemoryStore();
  }

  // ---- READ ---------------------------------------------------------

  async read(query: MemoryReadQuery, policy: MemoryPolicy): Promise<MemoryReadResult> {
    const now = new Date().toISOString();
    const audit = (decision: MemoryAudit["decision"], reason?: string): MemoryAudit => ({
      at: now, op: "read", decision, layer: query.layer, scope: query.scope ?? "*",
      key: query.key, agentId: query.agentId, userId: query.userId, reason,
    });

    if ((query.layer as MemoryLayer) === "RUN_STATE") {
      const a = audit("deny", "RUN_STATE is execution state, not memory");
      log.info("memory read denied", { ...a });
      return { allowed: false, records: [], reason: a.reason, audit: a };
    }
    if (!policy.layers.includes(query.layer)) {
      const a = audit("deny", `layer "${query.layer}" is not granted by the agent's memory policy`);
      log.info("memory read denied", { ...a });
      return { allowed: false, records: [], reason: a.reason, audit: a };
    }

    const readScope = policy.readPolicy[query.layer] ?? "own";
    const storeQuery = {
      userId: query.userId,
      layer: query.layer,
      scope: query.scope,
      key: query.key,
      status: "active" as const,
      notExpiredAsOf: now,
      limit: query.limit ?? 50,
      ...(readScope === "own" ? { agentId: query.agentId } : {}),
      ...(readScope === "agent-type" ? { agentType: query.agentType } : {}),
      // "user-global": userId only
    };

    const rows = await this.store.query(storeQuery);
    const a = audit("allow");
    log.info("memory read", { ...a, scopePolicy: readScope, hits: rows.length });
    return { allowed: true, records: rows.map(toPublic), audit: a };
  }

  // ---- WRITE -------------------------------------------------------

  async write(req: MemoryWriteRequest, policy: MemoryPolicy): Promise<MemoryWriteResult> {
    const now = new Date();
    const nowIso = now.toISOString();
    const audit = (decision: MemoryWriteResult["decision"], reason?: string): MemoryAudit => ({
      at: nowIso, op: "write", decision, layer: req.layer, scope: req.scope,
      key: req.key, agentId: req.agentId, userId: req.userId, reason,
    });

    // 1. shape
    const shape = validateMemoryWriteRequest(req);
    if (!shape.valid) {
      const reason = `invalid_record: ${shape.violations.map((x) => `${x.path} ${x.message}`).join("; ")}`;
      const a = audit("deny", reason);
      log.info("memory write rejected", { ...a });
      return { decision: "deny", status: "rejected", reason, audit: a };
    }
    if ((req.layer as MemoryLayer) === "RUN_STATE") {
      const a = audit("deny", "RUN_STATE is execution state, not memory");
      return { decision: "deny", status: "rejected", reason: a.reason, audit: a };
    }

    // 2. policy decision (incl. the "never silently promote" rule)
    const decision = resolveWriteDecision(policy, req.layer, req.provenance.origin);
    if (decision === "deny") {
      const reason = policy.layers.includes(req.layer)
        ? `writePolicy for layer "${req.layer}" is deny`
        : `layer "${req.layer}" is not granted by the agent's memory policy`;
      const a = audit("deny", reason);
      log.info("memory write denied", { ...a });
      return { decision: "deny", status: "rejected", reason, audit: a };
    }

    const forcedApproval =
      decision === "approval" &&
      (MEMORY_KNOWLEDGE_LAYERS as readonly string[]).includes(req.layer) &&
      req.provenance.origin === "agent-derived";

    const status: StoredMemoryRecord["status"] = decision === "allow" ? "active" : "pending_approval";
    const expiresAt = computeExpiry(req.retention, now);

    // 3. supersede prior ACTIVE record for the same key on an accepted `allow`
    if (decision === "allow") {
      const prior = await this.store.query({
        userId: req.userId, agentId: req.agentId, layer: req.layer, scope: req.scope, key: req.key, status: "active",
      });
      for (const p of prior) await this.store.markStatus(p.id, "expired");
    }

    const row = await this.store.insert({
      agentId: req.agentId,
      agentType: req.agentType,
      userId: req.userId,
      runId: req.runId ?? null,
      layer: req.layer,
      scope: req.scope,
      key: req.key,
      value: req.value,
      retention: req.retention ?? { mode: "persistent" },
      provenance: req.provenance,
      status,
      expiresAt,
    });

    const a = audit(decision, forcedApproval ? "knowledge-layer write from agent-derived output -> approval required" : undefined);
    log.info("memory write", { ...a, status, recordId: row.id });
    return {
      decision,
      status: decision === "allow" ? "active" : "pending_approval",
      recordId: row.id,
      reason: a.reason,
      audit: a,
    };
  }

  // ---- APPROVE ---------------------------------------------------

  /** Promote a pending_approval record to active. `approver` is a real user /
   *  admin id - never an agent. Supersedes the prior active record for the key. */
  async approvePending(recordId: string, approver: string): Promise<MemoryWriteResult> {
    const nowIso = new Date().toISOString();
    const rec = await this.store.getById(recordId);
    if (!rec) {
      return { decision: "deny", status: "rejected", reason: "record not found", audit: baseAudit("approve", "deny", nowIso, approver) };
    }
    if (rec.status !== "pending_approval") {
      return {
        decision: "deny", status: "rejected", reason: `record is "${rec.status}", not pending_approval`,
        audit: { at: nowIso, op: "approve", decision: "deny", layer: rec.layer, scope: rec.scope, key: rec.key, agentId: rec.agentId, userId: rec.userId, reason: "not pending" },
      };
    }
    const prior = await this.store.query({
      userId: rec.userId, agentId: rec.agentId, layer: rec.layer, scope: rec.scope, key: rec.key, status: "active",
    });
    for (const p of prior) await this.store.markStatus(p.id, "expired");
    await this.store.markStatus(recordId, "active");

    const a: MemoryAudit = {
      at: nowIso, op: "approve", decision: "allow", layer: rec.layer, scope: rec.scope,
      key: rec.key, agentId: rec.agentId, userId: rec.userId, reason: `approved by ${approver}`,
    };
    log.info("memory approve", { ...a });
    return { decision: "allow", status: "active", recordId, audit: a };
  }
}

function baseAudit(op: MemoryAudit["op"], decision: MemoryAudit["decision"], at: string, who: string): MemoryAudit {
  return { at, op, decision, layer: "-", scope: "-", agentId: "-", userId: who, reason: "record not found" };
}

/** Process-wide gateway, Prisma-backed. INERT until the A7 migration
 *  (20260906130000_add_agent_memory_record) is applied - no framework code
 *  calls this yet (A7 ships the authority, not the runtime wiring). Tests
 *  construct `new MemoryGateway({ store: new InMemoryStore() })` directly. */
export function createMemoryGateway(): MemoryGateway {
  return new MemoryGateway({ store: new PrismaMemoryStore() });
}
