// types/agent-framework/memory-contract.ts
// AT24 Agent Framework - Memory contract (A1).
//
// LOCKED: memory is provider-independent and policy-gated. An agent may only
// read/write a layer its MemoryPolicy grants - enforced by a MemoryGateway
// service (A7), never by direct database access from a tool handler.
//
// RUN_STATE is special: it lives on AgentRun / AgentStep rows, NOT in the
// AgentMemory table. It is listed here only so a policy can reference it;
// the memory contract's validators reject writing RUN_STATE through the
// memory layer.

import {
  type ContractValidationResult,
  type ContractViolation,
  contractResult,
  isIsoTimestamp,
  isNonEmptyString,
} from "./common";

export type MemoryLayer =
  | "SHORT_TERM"
  | "RUN_STATE"
  | "LONG_TERM"
  | "USER_CONTEXT"
  | "RESEARCH_MEMORY"
  | "STRATEGY_MEMORY"
  | "PERFORMANCE_MEMORY";

export const MEMORY_LAYERS: readonly MemoryLayer[] = [
  "SHORT_TERM",
  "RUN_STATE",
  "LONG_TERM",
  "USER_CONTEXT",
  "RESEARCH_MEMORY",
  "STRATEGY_MEMORY",
  "PERFORMANCE_MEMORY",
] as const;

/** Layers that are NOT backed by the AgentMemoryRecord table. RUN_STATE is
 *  transient/resumable execution state and lives on AgentRun/AgentStep -
 *  it is NOT memory (owner G06 lock). */
export const NON_TABLE_MEMORY_LAYERS: readonly MemoryLayer[] = ["RUN_STATE"] as const;

/** Table-backed layers, in a stable order (mirrors the AgentMemoryLayer
 *  Prisma enum). */
export const TABLE_MEMORY_LAYERS: readonly Exclude<MemoryLayer, "RUN_STATE">[] = [
  "SHORT_TERM",
  "LONG_TERM",
  "USER_CONTEXT",
  "RESEARCH_MEMORY",
  "STRATEGY_MEMORY",
  "PERFORMANCE_MEMORY",
] as const;

/** The "trusted reusable knowledge" layers. A write to one of these that
 *  originated as `agent-derived` ALWAYS requires approval, regardless of the
 *  agent's writePolicy - an agent must never silently promote its own output
 *  into trusted long-term knowledge (owner G06 lock; matters for the
 *  Knowledge/RAG governance loop later). */
export const MEMORY_KNOWLEDGE_LAYERS: readonly Exclude<MemoryLayer, "RUN_STATE">[] = [
  "LONG_TERM",
  "RESEARCH_MEMORY",
  "STRATEGY_MEMORY",
] as const;

/** Hard ceiling on a single memory record's serialized value. */
export const MEMORY_MAX_VALUE_BYTES = 16 * 1024;

/** Where a memory record came from. `agent-derived` is the constrained case. */
export type MemoryOrigin = "user" | "tool" | "agent-derived" | "system";

export type MemoryRecordStatus = "active" | "pending_approval" | "expired";

/** Every memory record carries provenance - who/what produced it and in which
 *  run. Never contains secrets (same rule as EvidenceProvenance). */
export interface MemoryProvenance {
  origin: MemoryOrigin;
  /** producer label: a tool id, "agent-runtime", a user id, "system". */
  producer: string;
  runId?: string;
  stepId?: string;
  createdAt: string;
}

/** A caller's request to write one memory record. */
export interface MemoryWriteRequest {
  agentId: string;
  /** the writing agent's type - denormalized so "agent-type" reads work. */
  agentType: string;
  userId: string;
  runId?: string | null;
  layer: Exclude<MemoryLayer, "RUN_STATE">;
  scope: string;
  key: string;
  value: unknown;
  retention?: MemoryRetention;
  provenance: MemoryProvenance;
}

/** A caller's request to read memory. */
export interface MemoryReadQuery {
  agentId: string;
  userId: string;
  /** the requesting agent's type - needed for the "agent-type" read scope. */
  agentType: string;
  layer: Exclude<MemoryLayer, "RUN_STATE">;
  scope?: string;
  key?: string;
  limit?: number;
}

export type MemoryWriteDecision = "allow" | "approval" | "deny";

/**
 * The core policy decision for a write. Deterministic, pure.
 *  - a layer not in `policy.layers` -> "deny"
 *  - base decision = policy.writePolicy[layer] ?? "deny"  (default-deny)
 *  - a knowledge layer + `agent-derived` origin -> forced to "approval"
 *    (never silently promote agent output into trusted knowledge)
 */
export function resolveWriteDecision(
  policy: MemoryPolicy,
  layer: Exclude<MemoryLayer, "RUN_STATE">,
  origin: MemoryOrigin,
): MemoryWriteDecision {
  if (!policy.layers.includes(layer)) return "deny";
  const base = policy.writePolicy[layer] ?? "deny";
  if (base === "deny") return "deny";
  if ((MEMORY_KNOWLEDGE_LAYERS as readonly string[]).includes(layer) && origin === "agent-derived") {
    return "approval";
  }
  return base; // "allow" or "approval"
}

export type MemoryReadPolicy = "own" | "agent-type" | "user-global";
export type MemoryWritePolicy = "allow" | "deny" | "approval";

export type MemoryRetention =
  | { mode: "ttl"; ttlDays: number }
  | { mode: "run" }
  | { mode: "persistent" };

/** Per-agent memory access rules. A layer absent from `layers` is fully
 *  inaccessible to the agent. `retention` / `readPolicy` / `writePolicy` are
 *  keyed by layer and only meaningful for layers in `layers`. */
export interface MemoryPolicy {
  layers: MemoryLayer[];
  retention: Partial<Record<MemoryLayer, MemoryRetention>>;
  readPolicy: Partial<Record<MemoryLayer, MemoryReadPolicy>>;
  writePolicy: Partial<Record<MemoryLayer, MemoryWritePolicy>>;
}

/** The default policy for a new agent: short-term run-scoped scratch only. */
export const DEFAULT_MEMORY_POLICY: MemoryPolicy = {
  layers: ["SHORT_TERM"],
  retention: { SHORT_TERM: { mode: "run" } },
  readPolicy: { SHORT_TERM: "own" },
  writePolicy: { SHORT_TERM: "allow" },
};

/** A stored memory record (extends the legacy AgentMemory row shape:
 *  value is `unknown` (JSON), plus layer/scope/retention/run linkage). */
export interface AgentMemoryRecord {
  id: string;
  agentId: string;
  userId: string;
  /** Present for RUN_STATE-adjacent scratch; null for durable layers. */
  runId?: string | null;
  layer: Exclude<MemoryLayer, "RUN_STATE">;
  /** Namespacing within the layer (e.g. "XAUUSD", "session:london"). */
  scope: string;
  key: string;
  value: unknown;
  retention: MemoryRetention;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isMemoryLayer(value: unknown): value is MemoryLayer {
  return typeof value === "string" && (MEMORY_LAYERS as readonly string[]).includes(value);
}

export function isTableBackedLayer(layer: MemoryLayer): boolean {
  return !(NON_TABLE_MEMORY_LAYERS as readonly string[]).includes(layer);
}

/** Validate a single write request's SHAPE (not policy - that is
 *  resolveWriteDecision + the gateway). Pure. */
export function validateMemoryWriteRequest(req: MemoryWriteRequest): ContractValidationResult {
  const v: ContractViolation[] = [];
  if (!isNonEmptyString(req.agentId)) v.push({ path: "agentId", message: "agentId is required." });
  if (!isNonEmptyString(req.agentType)) v.push({ path: "agentType", message: "agentType is required." });
  if (!isNonEmptyString(req.userId)) v.push({ path: "userId", message: "userId is required." });
  if (!isMemoryLayer(req.layer) || (req.layer as MemoryLayer) === "RUN_STATE") {
    v.push({ path: "layer", message: "layer must be a table-backed MemoryLayer (not RUN_STATE)." });
  }
  if (!isNonEmptyString(req.scope)) v.push({ path: "scope", message: "scope is required." });
  if (!isNonEmptyString(req.key)) v.push({ path: "key", message: "key is required." });
  if (typeof req.value === "undefined") v.push({ path: "value", message: "value is required (may be null)." });
  else {
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(req.value ?? null), "utf8");
    } catch {
      v.push({ path: "value", message: "value must be JSON-serializable." });
    }
    if (bytes > MEMORY_MAX_VALUE_BYTES) {
      v.push({ path: "value", message: `value is ${bytes} bytes; the limit is ${MEMORY_MAX_VALUE_BYTES}.` });
    }
  }
  if (req.retention) {
    const m = req.retention.mode;
    if (m !== "ttl" && m !== "run" && m !== "persistent") {
      v.push({ path: "retention.mode", message: 'retention.mode must be "ttl" | "run" | "persistent".' });
    } else if (m === "ttl" && (!Number.isFinite(req.retention.ttlDays) || req.retention.ttlDays <= 0)) {
      v.push({ path: "retention.ttlDays", message: "ttl retention needs a positive ttlDays." });
    }
    if (m === "run" && !req.runId) {
      v.push({ path: "retention", message: 'a "run" retention needs a runId.' });
    }
  }
  if (!req.provenance || typeof req.provenance !== "object") {
    v.push({ path: "provenance", message: "provenance is required." });
  } else {
    const okOrigin = ["user", "tool", "agent-derived", "system"].includes(req.provenance.origin);
    if (!okOrigin) v.push({ path: "provenance.origin", message: "provenance.origin is invalid." });
    if (!isNonEmptyString(req.provenance.producer)) {
      v.push({ path: "provenance.producer", message: "provenance.producer is required." });
    }
    if (!isIsoTimestamp(req.provenance.createdAt)) {
      v.push({ path: "provenance.createdAt", message: "provenance.createdAt must be ISO-8601." });
    }
  }
  return contractResult(v);
}

/** Validate a MemoryPolicy. Pure. Rejects unknown layers, retention/policy
 *  entries for layers not in `layers`, and a writable RUN_STATE (RUN_STATE
 *  is never written through the memory layer). */
export function validateMemoryPolicy(policy: MemoryPolicy): ContractValidationResult {
  const v: ContractViolation[] = [];

  if (!policy || !Array.isArray(policy.layers)) {
    return contractResult([{ path: "layers", message: "layers must be an array of MemoryLayer." }]);
  }

  const declared = new Set<MemoryLayer>();
  for (const layer of policy.layers) {
    if (!isMemoryLayer(layer)) {
      v.push({ path: "layers", message: `Unknown memory layer "${String(layer)}".` });
      continue;
    }
    if (declared.has(layer)) v.push({ path: "layers", message: `Duplicate memory layer "${layer}".` });
    declared.add(layer);
  }

  const checkKeyedBlock = (block: Partial<Record<string, unknown>>, name: string) => {
    for (const key of Object.keys(block ?? {})) {
      if (!isMemoryLayer(key)) {
        v.push({ path: `${name}.${key}`, message: `Unknown memory layer "${key}".` });
      } else if (!declared.has(key)) {
        v.push({ path: `${name}.${key}`, message: `Layer "${key}" is configured but not in "layers".` });
      }
    }
  };
  checkKeyedBlock(policy.retention, "retention");
  checkKeyedBlock(policy.readPolicy, "readPolicy");
  checkKeyedBlock(policy.writePolicy, "writePolicy");

  if (policy.writePolicy?.RUN_STATE && policy.writePolicy.RUN_STATE !== "deny") {
    v.push({
      path: "writePolicy.RUN_STATE",
      message: "RUN_STATE is never written through the memory layer (it lives on AgentRun/AgentStep).",
    });
  }

  return contractResult(v);
}
