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

import type {
  Classification,
  Sufficiency,
  WebSearchGateResult,
} from "@/types/knowledge-loop";

export function webSearchGate(
  c: Classification,
  retrievalSufficiency: Sufficiency,
): WebSearchGateResult {
  // FORBIDDEN — never send these to a web tool (§5).
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

  // REQUIRED — any of these (§5).
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

  return { useWebSearch: false, reason: "not-needed" };
}
