// services/knowledge-loop/orchestrator/web-search-gate.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: the web-search gate.
//
// Contract: AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §5. Pure, deterministic.
// Consumes the classifier output + the K2 retrieval sufficiency. "Errs toward
// enabling search when uncertain" — same disclosed-heuristic spirit as the
// existing `needsLiveInfo()`.
//
// Knowledge-first is NOT expressed here (retrieval always runs first, in the
// orchestrator). This gate only decides whether, AFTER retrieval, the answer
// turn should ALSO carry Claude's native web_search tool.
//
// K3-C §12.2 — "OFFER, not prediction": `useWebSearch: true` means the answer
// turn carries the tool; the MODEL still decides whether it needs to search
// ("search happened" is `webSearchUsed`, computed later from the provider
// response, never here). Pure: output depends only on
// (classification, retrievalSufficiency, bestSimilarity). Adds the
// `borderline-sufficient` rule; `historical` intent behaves like any STATIC
// intent — never web-forced by freshness, still web-eligible on
// INSUFFICIENT / STALE.

import { KNOWLEDGE_ANSWER_CONFIG, KNOWLEDGE_LOOP_CONFIG } from "@/config/knowledge-loop.config";
import type {
  Classification,
  Sufficiency,
  WebSearchGateResult,
} from "@/types/knowledge-loop";

export function webSearchGate(
  c: Classification,
  retrievalSufficiency: Sufficiency,
  bestSimilarity?: number,
): WebSearchGateResult {
  // FORBIDDEN — never send these to a web tool (§5 / §12.2).
  if (c.privacyClass === "sensitive") {
    return { useWebSearch: false, reason: "forbidden-sensitive" };
  }
  if (c.intent === "account-specific") {
    return { useWebSearch: false, reason: "forbidden-account" };
  }
  // a purely conceptual / policy question that knowledge already answers well
  // gains nothing from the web.
  if (
    (c.intent === "conceptual" || c.intent === "policy") &&
    retrievalSufficiency === "SUFFICIENT"
  ) {
    return { useWebSearch: false, reason: "forbidden-conceptual-sufficient" };
  }

  // REQUIRED — any of these (§5 / §12.2).
  if (c.explicitFreshnessRequest) {
    return { useWebSearch: true, reason: "explicit-freshness" };
  }
  if (c.freshnessNeed === "DYNAMIC") {
    return { useWebSearch: true, reason: "dynamic-need" };
  }
  if (retrievalSufficiency === "INSUFFICIENT") {
    return { useWebSearch: true, reason: "insufficient" };
  }
  if (retrievalSufficiency === "STALE") {
    return { useWebSearch: true, reason: "stale" };
  }
  // §12.2 — a low-confidence ("other") query whose only knowledge hit is
  // barely over the sufficiency threshold: offer the web as a safety net.
  if (
    c.intent === "other" &&
    retrievalSufficiency === "SUFFICIENT" &&
    typeof bestSimilarity === "number" &&
    bestSimilarity <
      KNOWLEDGE_LOOP_CONFIG.RELEVANCE_GOOD + KNOWLEDGE_ANSWER_CONFIG.BORDERLINE_MARGIN
  ) {
    return { useWebSearch: true, reason: "borderline-sufficient" };
  }

  return { useWebSearch: false, reason: "not-needed" };
}
