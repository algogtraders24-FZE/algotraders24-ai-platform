// services/knowledge-loop/knowledge/freshness-sweep.ts
// Sprint K2-C — AT24 AI Assistant Knowledge Loop: freshness sweep.
//
// Contract: KNOWLEDGE_CONTRACT.md §5 (freshness classes) + §4.4 transition
// table ("deprecated → archived | Governance.archive() OR freshness sweep";
// "DYNAMIC past expiresAt → auto-deprecated + reason: expired").
//
// SCOPE (what the sweep MAY do):
//   - identify stale knowledge (PERIODIC past review-due) → FLAG only
//   - exclude expired content (DYNAMIC past `expiresAt`) → transition ACTIVE
//     → DEPRECATED (reason `expired`), which bumps the version fingerprint
//
// HARD LIMITS (what the sweep MUST NOT do — owner-locked, K2-C):
//   - never touches `KnowledgeCandidate` (the store has no candidate methods)
//   - never transitions anything TO `active` / `draft`
//   - never approves or promotes a candidate
//   - never bypasses human review or modifies governance authority
//   - PERIODIC rows are FLAGGED, never auto-deprecated (a human decides — K4/K6);
//     retrieval already demotes them via STALE_PENALTY at query time
//
// INV-1: a sweep can only make a row LESS reachable (active → deprecated), never
// more. `deprecate` goes through the same `KnowledgeStore.transition` the
// governance layer uses; the retrieval eligibility filter is untouched.

import { KNOWLEDGE_LOOP_CONFIG } from "@/config/knowledge-loop.config";
import type { FreshnessSweepResult } from "@/types/knowledge-loop";
import type { KnowledgeStore } from "./ports";
import { isPeriodicStale } from "./retrieval";

const C = KNOWLEDGE_LOOP_CONFIG;

/** actorId recorded on sweep-driven deprecations (KNOWLEDGE_RETRIEVAL_CONTRACT §7.4). */
export const FRESHNESS_SWEEP_ACTOR = "system:freshness-sweep";

export interface FreshnessSweepDeps {
  store: KnowledgeStore;
  clock?: () => Date;
  /** cap on auto-deprecations per run (safety valve for a first prod run). */
  maxDeprecations?: number;
}

export async function runFreshnessSweep(
  deps: FreshnessSweepDeps,
): Promise<FreshnessSweepResult> {
  const now = (deps.clock ?? (() => new Date()))();
  const max = deps.maxDeprecations ?? Number.POSITIVE_INFINITY;

  const active = await deps.store.list({ lifecycleStatus: "active" });

  const dynamicExpiredDeprecated: FreshnessSweepResult["dynamicExpiredDeprecated"] = [];
  const periodicReviewDue: FreshnessSweepResult["periodicReviewDue"] = [];
  let latestFingerprint = await deps.store.getVersionFingerprint();

  for (const rec of active) {
    // guard — never act on a non-active / user-scope / already-superseded row
    if (rec.lifecycleStatus !== "active") continue;
    if (rec.deletedAt || rec.supersededById) continue;

    // DYNAMIC past expiry → auto-deprecate (contract-sanctioned).
    if (
      rec.freshnessClass === "DYNAMIC" &&
      rec.expiresAt &&
      rec.expiresAt.getTime() <= now.getTime()
    ) {
      if (dynamicExpiredDeprecated.length >= max) continue;
      const { versionFingerprint } = await deps.store.transition({
        id: rec.id,
        to: "deprecated",
        actorId: FRESHNESS_SWEEP_ACTOR,
        reason: "expired",
      });
      latestFingerprint = versionFingerprint;
      dynamicExpiredDeprecated.push({
        knowledgeId: rec.id,
        expiresAt: rec.expiresAt.toISOString(),
      });
      continue;
    }

    // PERIODIC past review-due → FLAG ONLY (never auto-deprecate).
    if (rec.freshnessClass === "PERIODIC" && isPeriodicStale(rec, now)) {
      const days = rec.freshnessReviewEveryDays ?? C.DEFAULT_PERIODIC_REVIEW_DAYS;
      const base = rec.lastReviewedAt ?? rec.approvedAt ?? rec.createdAt;
      const dueAt = base.getTime() + days * 24 * 60 * 60 * 1000;
      const longOverdue =
        now.getTime() >
        base.getTime() +
          days * C.PERIODIC_LONG_OVERDUE_FACTOR * 24 * 60 * 60 * 1000;
      periodicReviewDue.push({
        knowledgeId: rec.id,
        dueSince: new Date(dueAt).toISOString(),
        longOverdue,
      });
    }
  }

  return {
    scannedActive: active.length,
    dynamicExpiredDeprecated,
    periodicReviewDue,
    versionFingerprint: latestFingerprint,
    ranAt: now.toISOString(),
  };
}
