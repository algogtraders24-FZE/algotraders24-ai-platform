// services/knowledge-loop/orchestrator/in-memory-adapters.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: offline test doubles.
// `validate:knowledge-loop-orchestrator` runs entirely against these — no DB,
// no LLM, no network (K1/K2 precedent).

import type {
  RetrievalHit,
  RetrievalOptions,
  RetrievalResult,
  Sufficiency,
  AIWebSource,
} from "@/types/knowledge-loop";
import type {
  AnswerGenInput,
  AnswerGenResult,
  AnswerProviderSlot,
  RetrievalPort,
} from "./ports";

export { InMemoryProvenanceStore } from "./provenance-store";

// ── fake retrieval ────────────────────────────────────────────────────
export interface FakeRetrievalConfig {
  sufficiency?: Sufficiency;
  hits?: Partial<RetrievalHit>[];
  contextBlock?: string;
  bestSimilarity?: number;
  fromCache?: boolean;
  throwError?: boolean;
}

export class FakeRetrieval implements RetrievalPort {
  lastQuery: string | null = null;
  lastScopes: string[] = [];
  constructor(private cfg: FakeRetrievalConfig = {}) {}

  set(cfg: FakeRetrievalConfig): void {
    this.cfg = cfg;
  }

  async retrieve(
    query: string,
    opts: RetrievalOptions,
  ): Promise<RetrievalResult> {
    this.lastQuery = query;
    this.lastScopes = [...opts.scopes];
    if (this.cfg.throwError) throw new Error("fake-retrieval-down");
    const hits: RetrievalHit[] = (this.cfg.hits ?? []).map((h, i) => ({
      knowledgeId: h.knowledgeId ?? `k${i}`,
      chunkId: h.chunkId ?? `k${i}:c0`,
      chunkIndex: h.chunkIndex ?? 0,
      content: h.content ?? "fixture chunk",
      similarity: h.similarity ?? 0.7,
      finalScore: h.finalScore ?? 0.7,
      authorityWeight: h.authorityWeight ?? 1,
      sourceType: h.sourceType ?? null,
      freshnessClass: h.freshnessClass ?? null,
      scope: h.scope ?? "assistant",
      stale: h.stale ?? false,
      version: h.version ?? 1,
      unverified: h.unverified ?? false,
    }));
    const sufficiency = this.cfg.sufficiency ?? "INSUFFICIENT";
    const contextBlock =
      this.cfg.contextBlock ??
      (hits.length > 0 ? hits.map((h) => h.content).join("\n---\n") : "");
    return {
      hits,
      contextBlock,
      sufficiency,
      bestSimilarity: this.cfg.bestSimilarity ?? hits[0]?.similarity ?? 0,
      fromCache: this.cfg.fromCache ?? false,
      latencyMs: 1,
      reason: "ok",
    };
  }
}

// ── fake provider slot ────────────────────────────────────────────────
export interface FakeProviderConfig {
  name?: string;
  available?: boolean;
  supportsWebSearch?: boolean;
  /** static reply text; ignored when `reply` is set. */
  text?: string;
  /** dynamic reply — sees the exact input each slot received. */
  reply?: (input: AnswerGenInput) => Partial<AnswerGenResult> & { text: string };
  /** throw instead of replying (simulates a provider outage). */
  throwError?: boolean;
  webSources?: AIWebSource[];
  searchCount?: number;
  webSearchUnavailable?: boolean;
}

export class FakeProviderSlot implements AnswerProviderSlot {
  readonly name: string;
  readonly supportsWebSearch: boolean;
  calls: AnswerGenInput[] = [];
  private cfg: FakeProviderConfig;

  constructor(cfg: FakeProviderConfig = {}) {
    this.cfg = cfg;
    this.name = cfg.name ?? "fake";
    this.supportsWebSearch = cfg.supportsWebSearch ?? false;
  }

  isAvailable(): boolean {
    return this.cfg.available ?? true;
  }

  async generate(input: AnswerGenInput): Promise<AnswerGenResult> {
    this.calls.push(input);
    if (this.cfg.throwError) throw new Error(`${this.name}-down`);
    const dyn = this.cfg.reply?.(input);
    const text = dyn?.text ?? this.cfg.text ?? "fake answer";
    const webSources = dyn?.webSources ?? this.cfg.webSources ?? [];
    const searchCount =
      dyn?.searchCount ?? this.cfg.searchCount ?? (webSources.length > 0 ? 1 : 0);
    return {
      text,
      webSources,
      searchCount,
      webSearchUsed: searchCount > 0 && webSources.length > 0,
      webSearchUnavailable:
        dyn?.webSearchUnavailable ?? this.cfg.webSearchUnavailable ?? false,
      stopReason: "end_turn",
    };
  }
}
