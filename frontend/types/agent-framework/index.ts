// types/agent-framework/index.ts
// AT24 Agent Framework - contract barrel (A1).
//
// The single import surface for the framework's declarative contracts.
// Everything re-exported here is pure: shapes, closed vocabularies,
// deterministic transition tables and pure validation predicates. No
// runtime behavior lives under types/agent-framework/ (see common.ts).
//
// Contract version is bumped only on a breaking change to any exported
// shape or vocabulary. Additive changes (a new optional field, a new enum
// member appended) do NOT bump it.

export const AGENT_FRAMEWORK_CONTRACT_VERSION = "AF-v1" as const;
export type AgentFrameworkContractVersion = typeof AGENT_FRAMEWORK_CONTRACT_VERSION;

export * from "./common";
export * from "./autonomy-contract";
export * from "./permission-contract";
export * from "./evidence-contract";
export * from "./memory-contract";
export * from "./tool-contract";
export * from "./agent-run-contract";
export * from "./agent-contract";
