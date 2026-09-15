// services/knowledge-loop/orchestrator/decide-path.ts
// Sprint K3-C (C3) — the retrieval/web decision matrix as ONE pure, ordered
// contract (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12.2).
//
// Why a module: the K3-B orchestrator expressed this decision as inline `if`
// statements. A later edit could reorder them — e.g. run the web-search gate
// BEFORE the account-specific short-circuit — and silently change the
// contract (an account-specific question with the word "latest" in it would
// then be offered a web search). Extracting it here makes every branch AND
// its ordering a testable, locked contract (`validate-knowledge-loop-
// decision-matrix`).
//
// This is a DECISION, not a prediction. `webSearchOffered: true` means the
// answer turn carries Claude's `web_search` tool; whether a search actually
// happens is the model's call, surfaced later as `webSearchUsed`.
//
// C3 does NOT wire this into the orchestrator — that single integration is
// C5, which also supplies the runtime `bestSimilarity` from the retrieval
// result and the post-generation guards below.

import type {
  Classification,
  FreshnessNeed,
  Sufficiency,
  AnswerSourceClass,
} from "@/types/knowledge-loop";
import { webSearchGate } from "./web-search-gate";

/** The retrieval facts the decision depends on (a subset of `RetrievalResult`). */
export interface RetrievalDecisionState {
  sufficiency: Sufficiency;
  /** `RetrievalResult.bestSimilarity` — 0 when there are no hits. */
  bestSimilarity: number;
  /** `RetrievalResult.hits.length > 0`. */
  hasHits: boolean;
  /** `RetrievalResult.contextBlock` is non-empty after trim. */
  contextBlockNonEmpty: boolean;
}

export interface PreGenerationDecision {
  /** `deterministic-account` → return the fixed pointer, NO retrieval call was
   *  needed, NO LLM, NO web. `generate` → run the provider chain. */
  route: "deterministic-account" | "generate";
  /** offer Claude's native web_search tool this turn (an OFFER, §12.2). */
  webSearchOffered: boolean;
  /** the gate's reason, or `"account-specific"` for the deterministic route. */
  gateReason: string;
  /** whether retrieved knowledge is eligible to count toward `sourceClass`
   *  (present + non-empty block + sufficiency not INSUFFICIENT/STALE). */
  knowledgeCounted: boolean;
}

/**
 * §12.2 steps 1–2, LOCKED ORDER:
 *   1. account-specific  → deterministic, no web  (precedence: BEFORE the gate)
 *   2. otherwise         → the web-search gate decides whether to OFFER web
 */
export function decidePreGeneration(
  c: Classification,
  r: RetrievalDecisionState,
): PreGenerationDecision {
  const knowledgeCounted =
    r.hasHits &&
    r.contextBlockNonEmpty &&
    (r.sufficiency === "SUFFICIENT" || r.sufficiency === "LOW");

  // 1 — account-specific short-circuit. Checked FIRST: it must win over every
  //     freshness / sufficiency signal (an account question mentioning
  //     "latest" or with an INSUFFICIENT retrieval is STILL deterministic).
  if (c.intent === "account-specific") {
    return {
      route: "deterministic-account",
      webSearchOffered: false,
      gateReason: "account-specific",
      knowledgeCounted: false, // retrieval is skipped on this route
    };
  }

  // 2 — the pure web-search gate (forbidden-before-required, §12.2).
  const gate = webSearchGate(c, r.sufficiency, r.bestSimilarity);
  return {
    route: "generate",
    webSearchOffered: gate.useWebSearch,
    gateReason: gate.reason,
    knowledgeCounted,
  };
}

/**
 * §12.2 step 3 — `sourceClass` from the OUTCOME (never the provider identity).
 * `DETERMINISTIC` is decided elsewhere (account route, chain exhausted, or the
 * live-figures guard below).
 */
export function deriveSourceClass(args: {
  webUsed: boolean;
  knowledgeCounted: boolean;
}): Exclude<AnswerSourceClass, "DETERMINISTIC"> {
  const { webUsed, knowledgeCounted } = args;
  if (webUsed) return knowledgeCounted ? "MIXED" : "CLAUDE_WEB_SEARCH";
  return knowledgeCounted ? "AT24_KNOWLEDGE" : "CLAUDE_REASONING";
}

/**
 * §12.2 step 4 — the DYNAMIC live-figures guard PREDICATE (pure). C5 supplies
 * the runtime inputs and, when this returns true, replaces the LLM answer with
 * a deterministic "I can't verify live figures right now" response.
 *
 * Fires only for a moving-number question that ended up NOT web-grounded AND
 * has no knowledge to stand on — a stale model answer there is a correctness
 * hazard. A knowledge-grounded answer (`AT24_KNOWLEDGE` / `MIXED`) is still
 * allowed to win.
 */
export function liveFiguresGuardApplies(args: {
  freshnessNeed: FreshnessNeed;
  /** the winning answer actually used web search results. */
  webGrounded: boolean;
  /** the winning answer is grounded in retrieved knowledge (sourceClass
   *  AT24_KNOWLEDGE or MIXED). */
  knowledgeGrounded: boolean;
}): boolean {
  return (
    args.freshnessNeed === "DYNAMIC" &&
    !args.webGrounded &&
    !args.knowledgeGrounded
  );
}
