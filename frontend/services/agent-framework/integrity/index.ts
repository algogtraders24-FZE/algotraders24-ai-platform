// services/agent-framework/integrity/index.ts
// AT24 Agent Framework - A6 evidence hardening + output integrity. Server-only.

export { checkOutputIntegrity } from "./output-integrity";
export type { IntegrityResult, IntegrityViolation, IntegrityInput } from "./output-integrity";
export { buildLineage, outputEvidenceIds } from "./evidence-lineage";
export type { LineageResult, LineageLink } from "./evidence-lineage";
