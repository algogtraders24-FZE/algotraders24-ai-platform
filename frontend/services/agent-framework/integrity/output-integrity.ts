// services/agent-framework/integrity/output-integrity.ts
// AT24 Agent Framework - A6. The deterministic, LLM-INDEPENDENT gate a run's
// output must pass BEFORE the run may be marked "succeeded".
//
// LOCKED (owner G05): an agent conclusion is not trustworthy merely because
// the agent produced it. This checker does NOT trust the Supervisor's or a
// specialist's own discipline - it re-verifies, structurally:
//   - the output is well-formed
//   - every cited evidence id belongs to THIS run and has intact lineage
//     back to a registered AT24 capability
//   - a "resolved" conclusion actually has evidence
//   - referenced evidence rows have valid provenance and carry no secrets
//   - a constrained agent (autonomy < 2) emits NO trading-action field and
//     NO buy/sell/win-rate/probability-of-profit semantics (the disclaimer
//     field is the one allowed place to say "not a trade recommendation")
//
// Pure: the runtime passes in the persisted trace. No I/O, no LLM.

import {
  type AgentDefinition,
  validateAgentEvidence,
  type AgentEvidence as ContractAgentEvidence,
} from "@/types/agent-framework";
import type { RunTrace } from "../supervisor/run-planner";
import type { ToolRegistry } from "../tools/tool-registry";
import { buildLineage, outputEvidenceIds } from "./evidence-lineage";

export interface IntegrityViolation {
  code: string;
  message: string;
}

export interface IntegrityResult {
  passed: boolean;
  violations: IntegrityViolation[];
  lineage: ReturnType<typeof buildLineage>;
}

export interface IntegrityInput {
  output: unknown;
  trace: RunTrace;
  definition: AgentDefinition;
  registry: ToolRegistry;
}

// Keys a constrained (autonomy < 2) agent's output must never contain, at
// any depth. These are trade-instruction fields.
const FORBIDDEN_KEYS = new Set([
  "entry", "entryzone", "entryprice", "stop", "stoploss", "sl",
  "takeprofit", "tp", "target", "targets", "positionsize", "size",
  "lotsize", "lots", "ordertype", "side", "direction", "signal",
  "buysignal", "sellsignal", "tradeaction", "action", "recommendation",
  "order", "trade",
]);

// Signal / performance-claim language forbidden in any string value except
// the whitelisted `disclaimer` field.
const FORBIDDEN_TEXT: RegExp[] = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bgo (?:long|short)\b/i,
  /\benter (?:a )?(?:long|short)\b/i,
  /win[- ]?rate/i,
  /probability of profit/i,
  /\d+\s*%\s*(?:chance|probability|win)/i,
  /\bguaranteed\b/i,
];

const DISCLAIMER_KEYS = new Set(["disclaimer", "disclaimers", "note", "notes"]);
const SECRET_KEY_RE = /(api[_-]?key|apikey|secret|password|passwd|token|bearer|authorization|private[_-]?key)/i;
const SECRET_VALUE_RE = /(-----BEGIN |bearer\s+[a-z0-9._-]{10,}|sk-[a-z0-9]{10,})/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively collect (keyPath, key, value) for every entry in an object graph. */
function* walk(node: unknown, path = ""): Generator<{ path: string; key: string; value: unknown }> {
  if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      yield { path: p, key: k, value: v };
      yield* walk(v, p);
    }
  } else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      yield* walk(node[i], `${path}[${i}]`);
    }
  }
}

export function checkOutputIntegrity(input: IntegrityInput): IntegrityResult {
  const { output, trace, definition, registry } = input;
  const v: IntegrityViolation[] = [];
  const constrained = definition.autonomyLevel < 2;
  const lineage = buildLineage(output, trace, registry);

  // 1. well-formed
  if (!isPlainObject(output)) {
    return {
      passed: false,
      violations: [{ code: "malformed_output", message: "output must be a plain object" }],
      lineage,
    };
  }
  if (typeof output.summary !== "undefined" && typeof output.summary !== "string") {
    v.push({ code: "malformed_output", message: "output.summary, when present, must be a string" });
  }

  // 2. evidence references belong to this run + full lineage
  const referenced = outputEvidenceIds(output);
  const runEvidenceIds = new Set(trace.evidence.map((e) => e.id));
  for (const id of referenced) {
    if (!runEvidenceIds.has(id)) {
      v.push({ code: "foreign_evidence_id", message: `output cites evidence "${id}" that does not belong to this run` });
    }
  }
  for (const gap of lineage.gaps) {
    v.push({ code: "broken_lineage", message: gap });
  }

  // 3. a resolved conclusion must actually have evidence
  if (output.resolved === true) {
    if (referenced.length === 0) {
      v.push({ code: "unsupported_claim", message: 'output.resolved is true but output cites no evidence' });
    }
    if (trace.evidence.length === 0) {
      v.push({ code: "unsupported_claim", message: 'output.resolved is true but the run captured no evidence' });
    }
    if (Array.isArray(output.basis) && output.basis.length === 0) {
      v.push({ code: "unsupported_claim", message: 'output.resolved is true but output.basis is empty' });
    }
  }

  // 4. referenced evidence rows: valid provenance + no secrets
  const evById = new Map(trace.evidence.map((e) => [e.id, e]));
  for (const id of referenced) {
    const row = evById.get(id);
    if (!row) continue; // already flagged as foreign
    const asContract: ContractAgentEvidence = {
      id: row.id,
      runId: row.runId,
      stepId: row.stepId,
      toolCallId: row.toolCallId ?? undefined,
      type: row.type,
      claim: row.claim,
      source: row.source,
      sourceId: row.sourceId,
      timestamp: (row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp)),
      data: row.data,
      relevance: row.relevance,
      confidence: row.confidence,
      provenance: normaliseProvenance(row.provenance),
      createdAt: (row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)),
    };
    const evCheck = validateAgentEvidence(asContract);
    for (const ev of evCheck.violations) {
      v.push({ code: "invalid_evidence", message: `evidence "${id}": ${ev.path} - ${ev.message}` });
    }
    // secrets scan on provenance (never on data - that is legitimate tool output)
    const provJson = JSON.stringify(row.provenance ?? {});
    if (SECRET_KEY_RE.test(provJson) || SECRET_VALUE_RE.test(provJson)) {
      v.push({ code: "sensitive_data", message: `evidence "${id}" provenance appears to contain a credential` });
    }
  }

  // 5. constrained agents: no trading-action fields, no signal language
  if (constrained) {
    for (const { path, key, value } of walk(output)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        v.push({ code: "forbidden_trading_field", message: `constrained agent output contains a trade field "${path}"` });
      }
      if (typeof value === "string" && !DISCLAIMER_KEYS.has(key.toLowerCase())) {
        for (const re of FORBIDDEN_TEXT) {
          if (re.test(value)) {
            v.push({ code: "forbidden_signal_language", message: `constrained agent output "${path}" matches ${re}` });
            break;
          }
        }
      }
    }
    // top-level string values without a key (rare) + summary already covered by walk
  }

  return { passed: v.length === 0, violations: v, lineage };
}

function normaliseProvenance(p: unknown): ContractAgentEvidence["provenance"] {
  const o = isPlainObject(p) ? p : {};
  return {
    producer: typeof o.producer === "string" ? o.producer : "",
    retrievedAt:
      typeof o.retrievedAt === "string"
        ? o.retrievedAt
        : o.retrievedAt instanceof Date
          ? o.retrievedAt.toISOString()
          : "",
    pipelineVersion: typeof o.pipelineVersion === "string" ? o.pipelineVersion : undefined,
    datasetId: typeof o.datasetId === "string" ? o.datasetId : undefined,
    freshness: typeof o.freshness === "string" ? o.freshness : undefined,
    reliability: typeof o.reliability === "string" ? o.reliability : undefined,
  };
}
