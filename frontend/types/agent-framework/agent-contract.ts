// types/agent-framework/agent-contract.ts
// AT24 Agent Framework - Agent Definition contract (A1).
//
// This is the versioned, vendor-neutral definition of an agent. It replaces
// the thin legacy `types/agent.ts` `Agent` shape for all new-framework code.
// The legacy type stays in place, untouched, for the legacy /dashboard/agents
// UI until A15 (AN1.2 decision D3).
//
// LOCKED (AN1.2):
//  - D1: `type` is a validated free string, checked against the code
//    AGENT_TYPE_REGISTRY (services/agent-framework/agent-type-registry.ts).
//    No Prisma enum.
//  - invariant 7: no vendor name in this contract. `modelPolicy` uses plain
//    model-id strings; LLM access is only ever through lib/ai's AIService.
//  - invariant 4: autonomyLevel defaults to 0.
//
// A `validateAgentDefinition()` result that is not `valid` means the
// definition cannot be saved - there is no partial-save path.

import {
  type ContractValidationResult,
  type ContractViolation,
  type JsonSchema,
  contractResult,
  isIdentifier,
  isNonEmptyString,
  isNonNegativeNumber,
} from "./common";
import {
  type PermissionPolicy,
  type LiveExecutionContext,
  DENY_LIVE_EXECUTION_CONTEXT,
  validatePermissionPolicy,
} from "./permission-contract";
import {
  type MemoryPolicy,
  validateMemoryPolicy,
} from "./memory-contract";
import {
  type AutonomyLevel,
  isAutonomyLevel,
  DEFAULT_AUTONOMY_LEVEL,
  MAX_CONFIGURABLE_AUTONOMY_V1,
} from "./autonomy-contract";

/** Draft -> active -> paused -> archived. Only `active` agents run. */
export type AgentDefinitionStatus = "draft" | "active" | "paused" | "archived";

export const AGENT_DEFINITION_STATUSES: readonly AgentDefinitionStatus[] = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;

/** Vendor-neutral model selection. `preferred` / `fallback` / `allowed` are
 *  opaque model-id strings resolved by lib/ai at runtime; the contract layer
 *  never names a provider, imports a provider SDK, or references a
 *  ProviderName union. */
export interface ModelPolicy {
  preferred: string;
  fallback: string[];
  /** The complete set the agent may use. `preferred` and every `fallback`
   *  must be a member. An empty list is invalid. */
  allowed: string[];
  maxContextTokens?: number;
}

/** A tool the agent may use, plus optional per-agent config / tighter ceiling. */
export interface ToolBinding {
  toolId: string;
  config?: Readonly<Record<string, unknown>>;
  /** Optional per-agent credit ceiling for this specific tool, <= the tool's
   *  own cost ceiling. */
  creditCeiling?: number;
}

export interface KnowledgeSourceRef {
  kind: "collection" | "document";
  id: string;
  readPolicy: "read" | "no-read";
}

export type AgentEventType = "schedule_tick" | "market_snapshot" | "news_published";

export const AGENT_EVENT_TYPES: readonly AgentEventType[] = [
  "schedule_tick",
  "market_snapshot",
  "news_published",
] as const;

export interface TriggerPolicy {
  manual: boolean;
  /** cron expression, or null for no schedule. */
  schedule: string | null;
  events: AgentEventType[];
}

export const DEFAULT_TRIGGER_POLICY: TriggerPolicy = {
  manual: true,
  schedule: null,
  events: [],
};

/** Per-agent credit ceilings. Enforced by the CreditGateway (A9). */
export interface CreditPolicy {
  perRunCeiling: number;
  perDayCeiling: number;
  /** Refuse to start a run whose pre-flight estimate exceeds this. */
  requireEstimateUnder: number;
}

export const DEFAULT_CREDIT_POLICY: CreditPolicy = {
  perRunCeiling: 100,
  perDayCeiling: 500,
  requireEstimateUnder: 100,
};

/** The full versioned agent definition. */
export interface AgentDefinition {
  id: string;
  /** Unique per user. Lowercase dotted/kebab identifier. */
  slug: string;
  /** Monotonic version string; each change snapshots an AgentVersion row. */
  version: string;
  name: string;
  description: string;
  /** Validated against AGENT_TYPE_REGISTRY at write time - NOT a Prisma enum. */
  type: string;
  status: AgentDefinitionStatus;
  /** The durable goal ("monitor Gold every 15m and produce a decision-support brief"). */
  objective: string;
  /** Operator system-prompt / behavioral instructions. */
  instructions: string;
  modelPolicy: ModelPolicy;
  tools: ToolBinding[];
  knowledgeSources: KnowledgeSourceRef[];
  memoryPolicy: MemoryPolicy;
  triggerPolicy: TriggerPolicy;
  permissionPolicy: PermissionPolicy;
  autonomyLevel: AutonomyLevel;
  creditPolicy: CreditPolicy;
  /** JSON Schema the agent's final structured output must satisfy. */
  outputSchema: JsonSchema;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/** An immutable snapshot of a definition at one version. */
export interface AgentVersionSnapshot {
  id: string;
  agentId: string;
  version: string;
  definition: AgentDefinition;
  createdAt: string;
}

export function isAgentDefinitionStatus(value: unknown): value is AgentDefinitionStatus {
  return typeof value === "string" && (AGENT_DEFINITION_STATUSES as readonly string[]).includes(value);
}

// ---- Validation -----------------------------------------------------

/** Options for validateAgentDefinition. `isRegisteredType` is injected so
 *  this contract file never imports the registry (which lives in services/*)
 *  - keeps the dependency direction contract <- registry, not the reverse. */
export interface AgentDefinitionValidationOptions {
  /** Returns true iff `type` resolves against AGENT_TYPE_REGISTRY. */
  isRegisteredType: (type: string) => boolean;
  /** The registry's autonomy cap for `type`, if any. */
  autonomyCapForType?: (type: string) => AutonomyLevel | undefined;
  /** Runtime-supplied live-execution context (defaults to fully denied). */
  liveExecution?: LiveExecutionContext;
}

function validateModelPolicy(mp: ModelPolicy, v: ContractViolation[]): void {
  if (!mp || typeof mp !== "object") {
    v.push({ path: "modelPolicy", message: "modelPolicy is required." });
    return;
  }
  if (!isNonEmptyString(mp.preferred)) v.push({ path: "modelPolicy.preferred", message: "preferred model id is required." });
  if (!Array.isArray(mp.fallback)) v.push({ path: "modelPolicy.fallback", message: "fallback must be an array." });
  if (!Array.isArray(mp.allowed) || mp.allowed.length === 0) {
    v.push({ path: "modelPolicy.allowed", message: "allowed must be a non-empty array of model ids." });
    return;
  }
  const allowed = new Set(mp.allowed);
  if (isNonEmptyString(mp.preferred) && !allowed.has(mp.preferred)) {
    v.push({ path: "modelPolicy.preferred", message: "preferred must be a member of allowed." });
  }
  for (const f of mp.fallback ?? []) {
    if (!allowed.has(f)) v.push({ path: "modelPolicy.fallback", message: `fallback "${f}" is not in allowed.` });
  }
  if (mp.maxContextTokens !== undefined && (!isNonNegativeNumber(mp.maxContextTokens) || mp.maxContextTokens <= 0)) {
    v.push({ path: "modelPolicy.maxContextTokens", message: "maxContextTokens must be a positive number when set." });
  }
}

function validateCreditPolicy(cp: CreditPolicy, v: ContractViolation[]): void {
  if (!cp || typeof cp !== "object") {
    v.push({ path: "creditPolicy", message: "creditPolicy is required." });
    return;
  }
  for (const key of ["perRunCeiling", "perDayCeiling", "requireEstimateUnder"] as const) {
    if (!isNonNegativeNumber(cp[key]) || cp[key] <= 0) {
      v.push({ path: `creditPolicy.${key}`, message: `${key} must be a positive number.` });
    }
  }
  if (isNonNegativeNumber(cp.perRunCeiling) && isNonNegativeNumber(cp.perDayCeiling) && cp.perRunCeiling > cp.perDayCeiling) {
    v.push({ path: "creditPolicy.perRunCeiling", message: "perRunCeiling cannot exceed perDayCeiling." });
  }
  if (isNonNegativeNumber(cp.requireEstimateUnder) && isNonNegativeNumber(cp.perRunCeiling) && cp.requireEstimateUnder > cp.perRunCeiling) {
    v.push({ path: "creditPolicy.requireEstimateUnder", message: "requireEstimateUnder cannot exceed perRunCeiling." });
  }
}

function validateTriggerPolicy(tp: TriggerPolicy, v: ContractViolation[]): void {
  if (!tp || typeof tp !== "object") {
    v.push({ path: "triggerPolicy", message: "triggerPolicy is required." });
    return;
  }
  if (typeof tp.manual !== "boolean") v.push({ path: "triggerPolicy.manual", message: "manual must be a boolean." });
  if (tp.schedule !== null && !isNonEmptyString(tp.schedule)) {
    v.push({ path: "triggerPolicy.schedule", message: "schedule must be a cron string or null." });
  }
  if (!Array.isArray(tp.events)) {
    v.push({ path: "triggerPolicy.events", message: "events must be an array." });
  } else {
    for (const e of tp.events) {
      if (!(AGENT_EVENT_TYPES as readonly string[]).includes(e)) {
        v.push({ path: "triggerPolicy.events", message: `Unknown event type "${String(e)}".` });
      }
    }
  }
  if (!tp.manual && tp.schedule === null && (tp.events?.length ?? 0) === 0) {
    v.push({ path: "triggerPolicy", message: "an agent must have at least one trigger (manual, schedule, or an event)." });
  }
}

/**
 * Validate a complete AgentDefinition. Pure - no I/O. Every failure is a
 * ContractViolation with a field path and a plain-language reason.
 */
export function validateAgentDefinition(
  def: AgentDefinition,
  opts: AgentDefinitionValidationOptions,
): ContractValidationResult {
  const v: ContractViolation[] = [];
  const liveCtx = opts.liveExecution ?? DENY_LIVE_EXECUTION_CONTEXT;

  if (!isNonEmptyString(def.id)) v.push({ path: "id", message: "id is required." });
  if (!isIdentifier(def.slug)) v.push({ path: "slug", message: "slug must be a lowercase dotted/kebab identifier." });
  if (!isNonEmptyString(def.version)) v.push({ path: "version", message: "version is required." });
  if (!isNonEmptyString(def.name)) v.push({ path: "name", message: "name is required." });
  if (!isNonEmptyString(def.description)) v.push({ path: "description", message: "description is required." });
  if (!isNonEmptyString(def.objective)) v.push({ path: "objective", message: "objective is required." });
  if (!isNonEmptyString(def.instructions)) v.push({ path: "instructions", message: "instructions is required." });

  if (!isAgentDefinitionStatus(def.status)) {
    v.push({ path: "status", message: `status must be one of: ${AGENT_DEFINITION_STATUSES.join(", ")}.` });
  }

  // D1: type is a validated free string against the code registry.
  if (!isNonEmptyString(def.type)) {
    v.push({ path: "type", message: "type is required." });
  } else if (!opts.isRegisteredType(def.type)) {
    v.push({ path: "type", message: `type "${def.type}" is not in AGENT_TYPE_REGISTRY.` });
  }

  validateModelPolicy(def.modelPolicy, v);
  validateCreditPolicy(def.creditPolicy, v);
  validateTriggerPolicy(def.triggerPolicy, v);

  if (!Array.isArray(def.tools)) {
    v.push({ path: "tools", message: "tools must be an array of ToolBinding." });
  } else {
    const seenTools = new Set<string>();
    def.tools.forEach((b, i) => {
      if (!isNonEmptyString(b?.toolId)) {
        v.push({ path: `tools[${i}].toolId`, message: "toolId is required." });
        return;
      }
      if (seenTools.has(b.toolId)) v.push({ path: `tools[${i}].toolId`, message: `duplicate tool binding "${b.toolId}".` });
      seenTools.add(b.toolId);
      if (b.creditCeiling !== undefined && (!isNonNegativeNumber(b.creditCeiling) || b.creditCeiling <= 0)) {
        v.push({ path: `tools[${i}].creditCeiling`, message: "creditCeiling must be a positive number when set." });
      }
    });
  }

  if (!Array.isArray(def.knowledgeSources)) {
    v.push({ path: "knowledgeSources", message: "knowledgeSources must be an array." });
  } else {
    def.knowledgeSources.forEach((k, i) => {
      if (k?.kind !== "collection" && k?.kind !== "document") {
        v.push({ path: `knowledgeSources[${i}].kind`, message: 'kind must be "collection" or "document".' });
      }
      if (!isNonEmptyString(k?.id)) v.push({ path: `knowledgeSources[${i}].id`, message: "id is required." });
      if (k?.readPolicy !== "read" && k?.readPolicy !== "no-read") {
        v.push({ path: `knowledgeSources[${i}].readPolicy`, message: 'readPolicy must be "read" or "no-read".' });
      }
    });
  }

  // Permission policy - includes the parser-layer half of the live-execution
  // double gate.
  const permResult = validatePermissionPolicy(def.permissionPolicy, liveCtx);
  for (const pv of permResult.violations) v.push({ path: `permissionPolicy.${pv.path}`, message: pv.message });

  // Memory policy.
  const memResult = validateMemoryPolicy(def.memoryPolicy);
  for (const mv of memResult.violations) v.push({ path: `memoryPolicy.${mv.path}`, message: mv.message });

  // Autonomy.
  if (!isAutonomyLevel(def.autonomyLevel)) {
    v.push({ path: "autonomyLevel", message: "autonomyLevel must be an integer 0-4." });
  } else {
    if (def.autonomyLevel > MAX_CONFIGURABLE_AUTONOMY_V1) {
      v.push({
        path: "autonomyLevel",
        message: `autonomyLevel ${def.autonomyLevel} exceeds the v1 maximum of ${MAX_CONFIGURABLE_AUTONOMY_V1} (L3/L4 are contract-only this sprint).`,
      });
    }
    const cap = opts.autonomyCapForType?.(def.type);
    if (cap !== undefined && def.autonomyLevel > cap) {
      v.push({
        path: "autonomyLevel",
        message: `autonomyLevel ${def.autonomyLevel} exceeds the registry cap (${cap}) for type "${def.type}".`,
      });
    }
  }

  if (!def.outputSchema || typeof def.outputSchema !== "object") {
    v.push({ path: "outputSchema", message: "outputSchema must be a JSON Schema object." });
  }

  return contractResult(v);
}

/** A minimal, valid-by-construction default definition body (id/slug/name
 *  still required from the caller). Useful for tests and the create form's
 *  initial state. Autonomy 0, manual trigger, short-term memory only,
 *  no permissions, no tools. */
export function makeDefaultAgentDefinitionBase(): Omit<
  AgentDefinition,
  "id" | "slug" | "version" | "name" | "createdAt" | "updatedAt"
> {
  return {
    description: "",
    type: "",
    status: "draft",
    objective: "",
    instructions: "",
    modelPolicy: { preferred: "", fallback: [], allowed: [] },
    tools: [],
    knowledgeSources: [],
    memoryPolicy: {
      layers: ["SHORT_TERM"],
      retention: { SHORT_TERM: { mode: "run" } },
      readPolicy: { SHORT_TERM: "own" },
      writePolicy: { SHORT_TERM: "allow" },
    },
    triggerPolicy: { ...DEFAULT_TRIGGER_POLICY },
    permissionPolicy: { granted: [] },
    autonomyLevel: DEFAULT_AUTONOMY_LEVEL,
    creditPolicy: { ...DEFAULT_CREDIT_POLICY },
    outputSchema: { type: "object" },
    deletedAt: null,
  };
}
