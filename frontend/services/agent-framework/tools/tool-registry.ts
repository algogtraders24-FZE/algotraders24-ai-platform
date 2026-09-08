// services/agent-framework/tools/tool-registry.ts
// AT24 Agent Framework - A2. The AT24-owned Tool Registry.
//
// LOCKED (AN1.4): the registry declares CAPABILITY and POLICY. It is never
// the execution authority - a ToolImplementation's handler delegates to an
// existing AT24 service. Only tools with a real callable implementation are
// registered; nothing is registered to make a UI look complete.
//
// Deterministic: registration rejects duplicates; lookup of an unknown id
// throws UnknownToolError; freeze() locks the set.

import {
  type ToolDefinition,
  type PermissionKey,
  type AutonomyLevel,
  UnknownToolError,
  validateToolDefinition,
} from "@/types/agent-framework";
import type { ToolImplementation } from "./tool-implementation";

/** Thrown when the same tool id is registered twice. */
export class DuplicateToolError extends Error {
  constructor(public readonly toolId: string) {
    super(`Tool "${toolId}" is already registered.`);
    this.name = "DuplicateToolError";
  }
}

/** Thrown when a malformed ToolDefinition is offered for registration. */
export class InvalidToolDefinitionError extends Error {
  constructor(public readonly toolId: string, public readonly violations: { path: string; message: string }[]) {
    super(`Tool "${toolId}" has an invalid definition: ${violations.map((v) => `${v.path}: ${v.message}`).join("; ")}`);
    this.name = "InvalidToolDefinitionError";
  }
}

/** The policy-facing view of a registered tool (no handler). */
export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  version: string;
  category: ToolDefinition["category"];
  requiredPermissions: PermissionKey[];
  autonomyFloor: AutonomyLevel;
  creditCost: ToolDefinition["creditCost"];
  executionMode: ToolDefinition["executionMode"];
  evidence: ToolDefinition["evidence"];
  status: ToolDefinition["status"];
  wraps: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolImplementation<never, unknown>>();
  private frozen = false;

  /** Deterministic registration. Rejects: a frozen registry, a duplicate
   *  id, a malformed definition, an id mismatch. */
  register<TInput, TOutput>(impl: ToolImplementation<TInput, TOutput>): this {
    if (this.frozen) {
      throw new Error("ToolRegistry is frozen; no further registration is permitted.");
    }
    const { definition } = impl;
    const result = validateToolDefinition(definition);
    if (!result.valid) {
      throw new InvalidToolDefinitionError(definition.id, result.violations);
    }
    if (this.tools.has(definition.id)) {
      throw new DuplicateToolError(definition.id);
    }
    this.tools.set(definition.id, impl as unknown as ToolImplementation<never, unknown>);
    return this;
  }

  /** Lock the registry - registration after this throws. */
  freeze(): this {
    this.frozen = true;
    return this;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  /** Lookup that returns undefined for an unknown id. */
  get(toolId: string): ToolImplementation<never, unknown> | undefined {
    return this.tools.get(toolId);
  }

  /** Lookup that throws UnknownToolError for an unknown id (G02 req. 10). */
  require(toolId: string): ToolImplementation<never, unknown> {
    const impl = this.tools.get(toolId);
    if (!impl) throw new UnknownToolError(toolId);
    return impl;
  }

  /** Every registered id, sorted - deterministic ordering. */
  ids(): string[] {
    return [...this.tools.keys()].sort();
  }

  /** Policy-facing descriptors for every registered tool, sorted by id. */
  list(): ToolDescriptor[] {
    return this.ids().map((id) => this.describe(id));
  }

  /** Policy-facing descriptor for one tool. Throws UnknownToolError if absent. */
  describe(toolId: string): ToolDescriptor {
    const { definition: d } = this.require(toolId);
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      version: d.version,
      category: d.category,
      requiredPermissions: [...d.requiredPermissions],
      autonomyFloor: d.autonomyFloor,
      creditCost: d.creditCost,
      executionMode: d.executionMode,
      evidence: d.evidence,
      status: d.status,
      wraps: d.wraps,
    };
  }
}
