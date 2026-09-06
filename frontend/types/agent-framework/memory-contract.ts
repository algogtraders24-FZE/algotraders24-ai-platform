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

/** Layers that are NOT backed by the AgentMemory table. */
export const NON_TABLE_MEMORY_LAYERS: readonly MemoryLayer[] = ["RUN_STATE"] as const;

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
