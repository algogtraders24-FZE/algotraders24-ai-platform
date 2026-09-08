// services/knowledge-loop/knowledge/retrieval.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop. Pure, deterministic scoring /
// ranking / selection helpers for KNOWLEDGE_RETRIEVAL_CONTRACT.md §3–§5. No
// I/O, no clock of its own (callers pass `now`). Fully unit-testable.

import { createHash } from "node:crypto";
import {
  KNOWLEDGE_LOOP_CONFIG,
  AUTHORITY_WEIGHTS,
  POLICY_TYPE_AUTHORITY,
  USER_SCOPE_AUTHORITY,
  DEFAULT_AUTHORITY,
} from "@/config/knowledge-loop.config";
import type {
  KnowledgeRecord,
  RetrievalHit,
  Sufficiency,
} from "@/types/knowledge-loop";
import type { VectorHit } from "./ports";

const C = KNOWLEDGE_LOOP_CONFIG;

/** trim + collapse internal whitespace. null → reject (empty/whitespace-only). */
export function normalizeQuery(
  raw: string,
): { normalized: string; lower: string } | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  return { normalized, lower: normalized.toLowerCase() };
}

/** sha256(normalizedLowerQuery | sortedScopes | callerScopeSig | fingerprint). */
export function retrievalCacheKey(
  lowerQuery: string,
  scopes: string[],
  callerScopeSig: string,
  versionFingerprint: string,
): string {
  const material = [
    lowerQuery,
    [...scopes].sort().join(","),
    callerScopeSig,
    versionFingerprint,
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

/** sha256 of the normalized (not lowercased) query — for the PII-light log. */
export function queryHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

/** A `scope = user` row is only ever eligible for its own owner. */
export function isEligible(rec: KnowledgeRecord, now: Date): boolean {
  if (rec.deletedAt) return false;
  if (rec.expiresAt && rec.expiresAt.getTime() <= now.getTime()) return false;
  if (rec.supersededById) return false;
  if (rec.scope === "user") {
    // legacy per-user rows: lifecycleStatus is null → still eligible for owner.
    return rec.lifecycleStatus === null || rec.lifecycleStatus === "active";
  }
  return rec.lifecycleStatus === "active";
}

/** KNOWLEDGE_RETRIEVAL_CONTRACT.md §4. Ranking only — never the threshold. */
export function authorityWeightFor(rec: KnowledgeRecord): number {
  if (rec.scope === "user") return USER_SCOPE_AUTHORITY;
  if (rec.knowledgeType === "policy") return POLICY_TYPE_AUTHORITY;
  if (rec.sourceType && rec.sourceType in AUTHORITY_WEIGHTS) {
    return AUTHORITY_WEIGHTS[rec.sourceType];
  }
  return DEFAULT_AUTHORITY;
}

/** PERIODIC row past `lastReviewedAt + freshnessReviewEveryDays`. */
export function isPeriodicStale(rec: KnowledgeRecord, now: Date): boolean {
  if (rec.freshnessClass !== "PERIODIC") return false;
  const days = rec.freshnessReviewEveryDays ?? C.DEFAULT_PERIODIC_REVIEW_DAYS;
  const base = rec.lastReviewedAt ?? rec.approvedAt ?? rec.createdAt;
  const dueAt = base.getTime() + days * 24 * 60 * 60 * 1000;
  return now.getTime() > dueAt;
}

export interface ScoredHit extends RetrievalHit {}

/** score one vector hit against its Knowledge row. */
export function scoreHit(
  vh: VectorHit,
  rec: KnowledgeRecord,
  now: Date,
): ScoredHit {
  const authorityWeight = authorityWeightFor(rec);
  const stale = isPeriodicStale(rec, now);
  const stalePenalty = stale ? C.STALE_PENALTY : 0;
  const finalScore = vh.similarity * authorityWeight - stalePenalty;
  return {
    knowledgeId: vh.knowledgeId,
    chunkId: vh.chunkId,
    chunkIndex: vh.chunkIndex,
    content: vh.content,
    similarity: vh.similarity,
    finalScore,
    authorityWeight,
    sourceType: rec.sourceType,
    freshnessClass: rec.freshnessClass,
    scope: rec.scope,
    stale,
    version: rec.version,
    unverified: rec.scope === "user",
  };
}

/**
 * sort by finalScore desc (tie-break: higher confidence → newer version →
 * higher authority), then cap chunks per doc, then drop near-identical chunk
 * text. Deterministic.
 */
export function rankAndDedup(
  scored: ScoredHit[],
  recById: Map<string, KnowledgeRecord>,
): ScoredHit[] {
  const sorted = [...scored].sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    const ra = recById.get(a.knowledgeId);
    const rb = recById.get(b.knowledgeId);
    const ca = ra?.confidence ?? 0;
    const cb = rb?.confidence ?? 0;
    if (cb !== ca) return cb - ca;
    if (b.version !== a.version) return b.version - a.version;
    if (b.authorityWeight !== a.authorityWeight)
      return b.authorityWeight - a.authorityWeight;
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });

  const perDoc = new Map<string, number>();
  const seenText = new Set<string>();
  const kept: ScoredHit[] = [];
  for (const h of sorted) {
    const n = perDoc.get(h.knowledgeId) ?? 0;
    if (n >= C.CHUNKS_PER_DOC_MAX) continue;
    const textKey = h.content.trim().toLowerCase().slice(0, 400);
    if (seenText.has(textKey)) continue;
    seenText.add(textKey);
    perDoc.set(h.knowledgeId, n + 1);
    kept.push(h);
  }
  return kept;
}

/** walk ranked rows, accumulate `- <content>\n` until the char budget. */
export function selectContext(ranked: ScoredHit[]): {
  contextBlock: string;
  kept: ScoredHit[];
} {
  let acc = "";
  const kept: ScoredHit[] = [];
  for (const h of ranked) {
    const piece = `- ${h.content}\n`;
    if (acc.length + piece.length > C.CONTEXT_CHAR_BUDGET) break;
    acc += piece;
    kept.push(h);
  }
  return { contextBlock: acc, kept };
}

/** KNOWLEDGE_RETRIEVAL_CONTRACT.md §3.2. */
export function computeSufficiency(
  kept: ScoredHit[],
  hadAnyAboveMin: boolean,
): Sufficiency {
  if (kept.length === 0) return "INSUFFICIENT";
  const best = kept[0];
  const good = kept.some((h) => h.finalScore >= C.RELEVANCE_GOOD && !h.stale);
  if (good) return "SUFFICIENT";
  if (best.stale) return "STALE";
  return hadAnyAboveMin ? "LOW" : "INSUFFICIENT";
}
