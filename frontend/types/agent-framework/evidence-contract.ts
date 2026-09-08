// types/agent-framework/evidence-contract.ts
// AT24 Agent Framework - Evidence contract (A1).
//
// LOCKED (core principle): agent evidence reuses the existing intelligence
// pipeline's vocabulary. This is a DELIBERATE typed sibling of
// types/evidence.ts's EvidenceItem - it does NOT replace it and nothing here
// is wired into that pipeline. The pipeline's EvidenceItem describes a
// market fact; AgentEvidence records WHICH tool result an agent actually
// cited in a run, with provenance, so any conclusion is traceable.
//
// LOCKED (AN1.2 invariant 2): AgentEvidence rows are append-only and
// immutable - no update path, no soft-delete. A re-run produces new rows.
//
// LOCKED (AN1.2 invariant 6): a claim in an agent's final output that has no
// backing AgentEvidence row fails the output integrity check (A4).

import {
  type ContractValidationResult,
  type ContractViolation,
  contractResult,
  isIsoTimestamp,
  isNonEmptyString,
  isUnitInterval,
} from "./common";

/** Closed vocabulary. Aligned with types/evidence.ts EvidenceType where they
 *  overlap; extended for agent-produced evidence kinds. Additive-only. */
export type AgentEvidenceType =
  | "market_data"
  | "indicator"
  | "news"
  | "regime"
  | "backtest"
  | "strategy_result"
  | "research_document"
  | "web_result"
  | "risk_assessment"
  | "derived";

export const AGENT_EVIDENCE_TYPES: readonly AgentEvidenceType[] = [
  "market_data",
  "indicator",
  "news",
  "regime",
  "backtest",
  "strategy_result",
  "research_document",
  "web_result",
  "risk_assessment",
  "derived",
] as const;

/** Where an evidence item came from and how trustworthy the path was. Never
 *  contains secrets, API keys, or raw provider error text (mirrors
 *  IntelligenceAuditTrace's "NEVER store" rule). */
export interface EvidenceProvenance {
  /** Logical producer: a provider name, an engine id, a tool id. Vendor
   *  strings are data here, not a typed dependency. */
  producer: string;
  /** When the underlying fact was captured/retrieved. */
  retrievedAt: string;
  /** Optional: the pipeline/engine version that produced it (e.g. "15D.12.0"). */
  pipelineVersion?: string;
  /** Optional: dataset identity for a backtest / historical result. */
  datasetId?: string;
  /** Optional: closed-vocabulary freshness/reliability labels, never raw payloads. */
  freshness?: string;
  reliability?: string;
}

/** One immutable, cited piece of evidence attached to a run. */
export interface AgentEvidence {
  id: string;
  runId: string;
  /** The step that produced it. */
  stepId: string;
  /** The tool call that produced it, when a tool was the source. */
  toolCallId?: string;
  type: AgentEvidenceType;
  /** Short human-readable statement of what this evidence shows. */
  claim: string;
  /** Logical source label (URL, dataset id, engine id, symbol...). */
  source: string;
  /** Stable id within the source (a URL, a run id, a symbol+timeframe key). */
  sourceId: string;
  /** When the underlying fact was true (may predate `createdAt`). */
  timestamp: string;
  /** The actual slice of tool output being cited. Opaque to the contract. */
  data: unknown;
  /** 0..1 - how relevant this evidence is to the run's goal. */
  relevance: number;
  /** 0..1 - confidence in the evidence itself. */
  confidence: number;
  provenance: EvidenceProvenance;
  /** Row creation time (append-only). */
  createdAt: string;
}

/** A reference from an output claim to the evidence backing it. */
export interface EvidenceRef {
  evidenceId: string;
}

/** What a tool handler emits: everything about a piece of evidence EXCEPT
 *  the identity/linkage fields the runtime assigns when it persists the row
 *  (id, runId, stepId, toolCallId, createdAt). The EvidenceRecorder (A6)
 *  turns a draft into a full AgentEvidence row. */
export type AgentEvidenceDraft = Omit<
  AgentEvidence,
  "id" | "runId" | "stepId" | "toolCallId" | "createdAt"
>;

/** Validate a draft (same rules as a full record, minus the runtime-
 *  assigned fields). Pure. */
export function validateAgentEvidenceDraft(draft: AgentEvidenceDraft): ContractValidationResult {
  const stub = draft as AgentEvidence;
  const full = validateAgentEvidence({
    ...stub,
    id: "draft",
    runId: "draft",
    stepId: "draft",
    createdAt: stub.timestamp,
  });
  // Drop violations for the fields a draft legitimately omits.
  const runtimeAssigned = new Set(["id", "runId", "stepId", "toolCallId", "createdAt"]);
  return contractResult(full.violations.filter((x) => !runtimeAssigned.has(x.path)));
}

export function isAgentEvidenceType(value: unknown): value is AgentEvidenceType {
  return typeof value === "string" && (AGENT_EVIDENCE_TYPES as readonly string[]).includes(value);
}

/** Validate a single AgentEvidence record's shape. Pure. */
export function validateAgentEvidence(evidence: AgentEvidence): ContractValidationResult {
  const v: ContractViolation[] = [];

  if (!isNonEmptyString(evidence.id)) v.push({ path: "id", message: "id is required." });
  if (!isNonEmptyString(evidence.runId)) v.push({ path: "runId", message: "runId is required." });
  if (!isNonEmptyString(evidence.stepId)) v.push({ path: "stepId", message: "stepId is required." });
  if (!isAgentEvidenceType(evidence.type)) {
    v.push({ path: "type", message: `type must be one of: ${AGENT_EVIDENCE_TYPES.join(", ")}.` });
  }
  if (!isNonEmptyString(evidence.claim)) v.push({ path: "claim", message: "claim is required." });
  if (!isNonEmptyString(evidence.source)) v.push({ path: "source", message: "source is required." });
  if (!isNonEmptyString(evidence.sourceId)) v.push({ path: "sourceId", message: "sourceId is required." });
  if (!isIsoTimestamp(evidence.timestamp)) v.push({ path: "timestamp", message: "timestamp must be ISO-8601." });
  if (!("data" in evidence)) v.push({ path: "data", message: "data is required (may be null)." });
  if (!isUnitInterval(evidence.relevance)) v.push({ path: "relevance", message: "relevance must be a number in [0, 1]." });
  if (!isUnitInterval(evidence.confidence)) v.push({ path: "confidence", message: "confidence must be a number in [0, 1]." });
  if (!isIsoTimestamp(evidence.createdAt)) v.push({ path: "createdAt", message: "createdAt must be ISO-8601." });

  if (!evidence.provenance || typeof evidence.provenance !== "object") {
    v.push({ path: "provenance", message: "provenance is required." });
  } else {
    if (!isNonEmptyString(evidence.provenance.producer)) {
      v.push({ path: "provenance.producer", message: "provenance.producer is required." });
    }
    if (!isIsoTimestamp(evidence.provenance.retrievedAt)) {
      v.push({ path: "provenance.retrievedAt", message: "provenance.retrievedAt must be ISO-8601." });
    }
  }

  return contractResult(v);
}
