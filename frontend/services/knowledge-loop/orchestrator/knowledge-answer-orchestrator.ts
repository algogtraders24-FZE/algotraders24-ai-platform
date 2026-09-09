// services/knowledge-loop/orchestrator/knowledge-answer-orchestrator.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: the knowledge-first gate.
//
// Contract: AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §1–§8. Sits AFTER the
// existing market-intelligence gate in `knowledge/chat/route.ts` and runs for
// every non-market turn. Same slot PATTERN as the market-intel
// `AIPresenterOrchestratorService` (ADR-K3-M1: pattern, not the literal
// envelope-bound service).
//
// Order of operations (K3_PREFLIGHT §4.2):
//   classify → KnowledgeService.retrieve (the FIRST intelligence layer, never
//   optional) → web-search gate → build one prompt → provider chain
//   [claude(+web_search) → gemini → openai → deterministic] → forbidden-language
//   scan on the winner → derive sourceClass → write KnowledgeAnswerProvenance
//   (best-effort) → return AnswerResult.
//
// K3 writes provenance ONLY. Candidate proposal/dedup is deferred to K4
// (ADR-K3-M8). No autonomous promotion. INV-1 holds — retrieval is the only
// knowledge path and it never reads `KnowledgeCandidate`.

import { KNOWLEDGE_ANSWER_CONFIG } from "@/config/knowledge-loop.config";
import { scanForForbiddenLanguage } from "@/lib/ai/compliance";
import { AI_COMMUNICATION_POLICY } from "@/lib/ai/response-policy";
import type {
  AnswerResult,
  AnswerSourceClass,
  AnswerSourceRef,
  AnswerProviderAttempt,
  AnswerTurn,
  Classification,
  KnowledgeAnswerProvenanceInput,
  RetrievalResult,
} from "@/types/knowledge-loop";
import { classify } from "../classifier/classify";
import { webSearchGate } from "./web-search-gate";
import type {
  AnswerGenInput,
  AnswerGenResult,
  AnswerProviderSlot,
  ProvenanceStorePort,
  RetrievalPort,
} from "./ports";

const C = KNOWLEDGE_ANSWER_CONFIG;

const KNOWLEDGE_LOOP_SYSTEM_INSTRUCTION =
  "You are the AT24 platform assistant. An AT24 KNOWLEDGE block may be provided " +
  "below — when it is, treat it as the authoritative source for anything about " +
  "AT24 products, platform behaviour, pricing, and policy, and prefer it over " +
  "your own prior knowledge. If the knowledge block does not cover the " +
  "question, say so briefly, then answer from general knowledge or (when web " +
  "results are provided) from those, and cite them. Never invent AT24 " +
  "specifics. Never give individualised financial or investment advice.";

const DETERMINISTIC_FALLBACK =
  "I couldn't put together a verified answer for that right now. Try rephrasing " +
  "the question, or contact support if it's urgent.";

export interface KnowledgeAnswerOrchestratorDeps {
  retrieval: RetrievalPort;
  /** ordered provider chain — [claude, gemini, openai] in production. */
  slots: AnswerProviderSlot[];
  provenance: ProvenanceStorePort;
  /** injectable for deterministic tests. */
  clock?: () => number;
}

export class KnowledgeAnswerOrchestrator {
  private readonly retrieval: RetrievalPort;
  private readonly slots: AnswerProviderSlot[];
  private readonly provenance: ProvenanceStorePort;
  private readonly now: () => number;

  constructor(deps: KnowledgeAnswerOrchestratorDeps) {
    this.retrieval = deps.retrieval;
    this.slots = deps.slots;
    this.provenance = deps.provenance;
    this.now = deps.clock ?? (() => Date.now());
  }

  async answer(turn: AnswerTurn): Promise<AnswerResult> {
    const startedAt = this.now();
    const history = (turn.history ?? []).slice(-C.HISTORY_TURNS_MAX);
    const classification = classify(turn.message);

    // ── account-specific → deterministic pointer, NO LLM call (contract §8). ──
    if (classification.intent === "account-specific") {
      return this.finishDeterministic(
        turn,
        classification,
        C.ACCOUNT_SPECIFIC_POINTER,
        // a fresh empty retrieval shape — retrieval is intentionally skipped.
        emptyRetrieval(),
        startedAt,
        "account-specific",
      );
    }

    // ── 1. retrieval — ALWAYS first, never optional (knowledge-first). ──
    let retrieval: RetrievalResult;
    try {
      retrieval = await this.retrieval.retrieve(turn.message, {
        callerUserId: turn.callerUserId,
        callerRole: turn.callerRole,
        scopes: [...C.ASSISTANT_SCOPES],
        topK: C.RETRIEVE_TOP_K,
        conversationId: turn.conversationId,
        knowledgeId: turn.knowledgeId,
      });
    } catch {
      retrieval = emptyRetrieval();
    }

    // ── 2. web-search gate — pure fn of classifier + retrieval sufficiency. ──
    const gate = webSearchGate(classification, retrieval.sufficiency);

    // ── 3. one prompt, shared by every slot. ──
    const genInput: AnswerGenInput = {
      system: `${AI_COMMUNICATION_POLICY}\n\n${KNOWLEDGE_LOOP_SYSTEM_INSTRUCTION}`,
      knowledgeBlock: retrieval.contextBlock ?? "",
      history,
      userMessage: turn.message,
      webSearchEnabled: gate.useWebSearch,
    };

    // ── 4. provider chain — fall through on throw / empty / forbidden text. ──
    const attempts: AnswerProviderAttempt[] = [];
    let winner: { slot: AnswerProviderSlot; res: AnswerGenResult } | null = null;

    for (const slot of this.slots) {
      if (!slot.isAvailable()) {
        attempts.push({ provider: slot.name, attempted: false, ok: false });
        continue;
      }
      const t0 = this.now();
      try {
        const res = await slot.generate(genInput);
        const latencyMs = this.now() - t0;
        const text = (res.text ?? "").trim();
        if (!text) {
          attempts.push({
            provider: slot.name,
            attempted: true,
            ok: false,
            failure: "empty-output",
            latencyMs,
          });
          continue;
        }
        const forbidden = scanForForbiddenLanguage(text);
        if (forbidden.length > 0) {
          attempts.push({
            provider: slot.name,
            attempted: true,
            ok: false,
            failure: `forbidden-language: ${forbidden.join(", ")}`,
            latencyMs,
            forbiddenLanguage: true,
          });
          continue;
        }
        attempts.push({
          provider: slot.name,
          attempted: true,
          ok: true,
          latencyMs,
        });
        winner = { slot, res: { ...res, text } };
        break;
      } catch (err) {
        attempts.push({
          provider: slot.name,
          attempted: true,
          ok: false,
          failure: err instanceof Error ? err.message : String(err),
          latencyMs: this.now() - t0,
        });
      }
    }

    // ── 5. no slot produced a clean answer → deterministic fallback. ──
    if (!winner) {
      return this.finishDeterministic(
        turn,
        classification,
        DETERMINISTIC_FALLBACK,
        retrieval,
        startedAt,
        "provider-chain-exhausted",
        attempts,
        gate.useWebSearch,
      );
    }

    // ── 6. derive sourceClass + per-source contributions (deterministic). ──
    const webUsed = winner.res.webSearchUsed;
    const webUnavailable =
      gate.useWebSearch && winner.res.webSearchUnavailable && !webUsed;
    const hasKnowledge =
      retrieval.hits.length > 0 && (retrieval.contextBlock ?? "").trim() !== "";
    const knowledgeCounted =
      hasKnowledge &&
      (retrieval.sufficiency === "SUFFICIENT" || retrieval.sufficiency === "LOW");

    const sourceClass: AnswerSourceClass = webUsed
      ? knowledgeCounted
        ? "MIXED"
        : "CLAUDE_WEB_SEARCH"
      : knowledgeCounted
        ? "AT24_KNOWLEDGE"
        : "CLAUDE_REASONING";

    const knowledgeRefs: AnswerSourceRef[] = retrieval.hits.map((h) => ({
      kind: "knowledge",
      knowledgeId: h.knowledgeId,
      chunkId: h.chunkId,
      chunkIndex: h.chunkIndex,
      similarity: h.similarity,
      snippet:
        h.content.length > 180 ? `${h.content.slice(0, 180)}…` : h.content,
      usedInAnswer: sourceClass === "AT24_KNOWLEDGE" || sourceClass === "MIXED",
    }));
    const webRefs: AnswerSourceRef[] = winner.res.webSources.map((s) => ({
      kind: "web",
      url: s.url,
      title: s.title,
      citedText: s.citedTexts[0],
      usedInAnswer: true,
    }));

    const latencyMs = this.now() - startedAt;
    const result: AnswerResult = {
      text: winner.res.text,
      sourceClass,
      providerUsed: winner.slot.name,
      webSearchUsed: webUsed,
      webSearchRequestedButUnavailable: webUnavailable,
      sources: [...knowledgeRefs, ...webRefs],
      retrievalSufficiency: retrieval.sufficiency,
      classification,
      fromCache: retrieval.fromCache,
      integrityPassed: true,
      latencyMs,
    };

    result.provenanceId =
      (await this.writeProvenance({
        turn,
        classification,
        retrieval,
        result,
        attempts,
        webSearchRequested: gate.useWebSearch,
      })) ?? undefined;

    return result;
  }

  // ── deterministic terminal — account-specific OR chain-exhausted. ──
  private async finishDeterministic(
    turn: AnswerTurn,
    classification: Classification,
    text: string,
    retrieval: RetrievalResult,
    startedAt: number,
    _reason: string,
    attempts: AnswerProviderAttempt[] = [],
    webSearchRequested = false,
  ): Promise<AnswerResult> {
    const latencyMs = this.now() - startedAt;
    const result: AnswerResult = {
      text,
      sourceClass: "DETERMINISTIC",
      providerUsed: "deterministic",
      webSearchUsed: false,
      webSearchRequestedButUnavailable: false,
      sources: [],
      retrievalSufficiency: retrieval.sufficiency,
      classification,
      fromCache: false,
      integrityPassed: true,
      latencyMs,
    };
    result.provenanceId =
      (await this.writeProvenance({
        turn,
        classification,
        retrieval,
        result,
        attempts,
        webSearchRequested,
      })) ?? undefined;
    return result;
  }

  private async writeProvenance(args: {
    turn: AnswerTurn;
    classification: Classification;
    retrieval: RetrievalResult;
    result: AnswerResult;
    attempts: AnswerProviderAttempt[];
    webSearchRequested: boolean;
  }): Promise<string | null> {
    const { turn, classification, retrieval, result, attempts } = args;
    const input: KnowledgeAnswerProvenanceInput = {
      userId: turn.callerUserId,
      conversationId: turn.conversationId ?? null,
      messageId: turn.messageId ?? null,
      requestId: turn.requestId,
      sourceClass: result.sourceClass,
      knowledgeContributions: result.sources.filter((s) => s.kind === "knowledge"),
      webContributions: result.sources.filter((s) => s.kind === "web"),
      providerUsed: result.providerUsed,
      providerAttempts: attempts,
      webSearchUsed: result.webSearchUsed,
      webSearchRequestedButUnavailable: result.webSearchRequestedButUnavailable,
      retrievalSufficiency: retrieval.sufficiency,
      conflict: retrieval.conflict ?? null,
      integrityPassed: result.integrityPassed,
      freshnessClass: retrieval.hits[0]?.freshnessClass ?? null,
      privacyClass: classification.privacyClass,
      candidateCreatedId: null, // K4 — never in K3
      answerCached: false, // K5
      servedFromCache: false, // K5
      latencyMs: result.latencyMs,
    };
    return this.provenance.write(input).catch(() => null);
  }
}

function emptyRetrieval(): RetrievalResult {
  return {
    hits: [],
    contextBlock: "",
    sufficiency: "INSUFFICIENT",
    bestSimilarity: 0,
    fromCache: false,
    latencyMs: 0,
    reason: "skipped",
  };
}
