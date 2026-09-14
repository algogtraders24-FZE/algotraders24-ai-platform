// services/knowledge-loop/orchestrator/telemetry.ts
// Sprint K3-C (C8) — observability & cost boundary (contract §12.6, D-K3C-8).
//
// The `KnowledgeAnswerProvenance` row (built by build-provenance.ts, C4) is
// the system of record. This module derives exactly ONE structured, loggable
// line from that SAME already-built, already-sanitised
// `KnowledgeAnswerProvenanceInput` — a fixed key set, zero raw content, no
// new table, no dashboard, no new logging subsystem.
//
// `buildTelemetryLine` is pure and reads nothing but scalars/enums off an
// input whose `ProvenanceFacts` origin (build-provenance.ts) STRUCTURALLY
// cannot carry the raw user query, the generated answer, conversation
// history, full Knowledge/web-page content, or a secret — there is nothing
// here TO leak. Every field is a boolean, a small integer, an enum-like
// string, or `null`.
//
// `emitAnswerTelemetry` is the one side-effecting call — `console.info`, a
// fixed event name, once per `answer()` turn (winner or deterministic
// terminal), called by the orchestrator right after the provenance write
// settles (so `provenanceWritten` is honest).

import type { KnowledgeAnswerProvenanceInput } from "@/types/knowledge-loop";

export const TELEMETRY_EVENT_NAME = "knowledge_answer_turn";

/** The one structured line per turn (D-K3C-8). Every value is a primitive —
 *  no nested object, no array — so there is no room for a content field to
 *  sneak in later without changing this type. */
export interface TelemetryLine {
  requestId: string;
  sourceClass: string;
  providerUsed: string;
  retrievalSufficiency: string;
  hitCount: number;
  webSearchOffered: boolean;
  searchCount: number;
  webSearchUsed: boolean;
  /** operational fact (§12.4) — independent of the evidence fact below. */
  webSearchFailed: boolean;
  webSearchPartialFailure: boolean;
  /** evidence fact (§12.4) — independent of `webSearchFailed`. */
  webSearchRequestedButUnavailable: boolean;
  continuationCount: number;
  continuationBudgetExhausted: boolean;
  truncated: boolean;
  retrievalFromCache: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  integrityPassed: boolean;
  failureCategory: string | null;
  latencyMs: number;
  /** did the best-effort `KnowledgeAnswerProvenance` write succeed. */
  provenanceWritten: boolean;
}

/** Pure — derives the telemetry line from the provenance input the
 *  orchestrator already built via `buildProvenance` (C4). Never reads
 *  `knowledgeContributions` / `webContributions` / `providerAttempts` (the
 *  content-bearing / per-attempt fields) — only `turnMeta` + the top-level
 *  scalars, all already sanitised. */
export function buildTelemetryLine(
  input: KnowledgeAnswerProvenanceInput,
  provenanceWritten: boolean,
): TelemetryLine {
  const meta = input.turnMeta;
  return {
    requestId: input.requestId,
    sourceClass: input.sourceClass,
    providerUsed: input.providerUsed,
    retrievalSufficiency: input.retrievalSufficiency,
    hitCount: meta?.knowledgeHitCount ?? 0,
    webSearchOffered: meta?.webSearchOffered ?? false,
    searchCount: meta?.searchCount ?? 0,
    webSearchUsed: input.webSearchUsed,
    webSearchFailed: meta?.webSearchFailed ?? false,
    webSearchPartialFailure: meta?.webSearchPartialFailure ?? false,
    webSearchRequestedButUnavailable: input.webSearchRequestedButUnavailable,
    continuationCount: meta?.continuationCount ?? 0,
    continuationBudgetExhausted: meta?.continuationBudgetExhausted ?? false,
    truncated: meta?.truncated ?? false,
    retrievalFromCache: meta?.retrievalFromCache ?? false,
    promptTokens: meta?.promptTokens ?? null,
    completionTokens: meta?.completionTokens ?? null,
    integrityPassed: input.integrityPassed,
    failureCategory: meta?.failureCategory ?? null,
    latencyMs: input.latencyMs,
    provenanceWritten,
  };
}

/** The orchestrator calls this exactly once per `answer()` turn, right after
 *  `this.provenance.write(...)` settles. `console.info` only — no new
 *  logging subsystem, no dashboard, no table. */
export function emitAnswerTelemetry(
  input: KnowledgeAnswerProvenanceInput,
  provenanceWritten: boolean,
): void {
  console.info(TELEMETRY_EVENT_NAME, buildTelemetryLine(input, provenanceWritten));
}
