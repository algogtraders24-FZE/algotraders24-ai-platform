// services/knowledge-loop/classifier/classify.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: query classifier.
//
// Contract: AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §3. A DISCLOSED HEURISTIC,
// not an LLM call (K0 §3 / K1_DECISION spirit / same style as the existing
// `detectSupportedMarketSymbol` + `needsLiveInfo` in services/ai/assistant.
// service.ts). Pure, deterministic, no I/O. An LLM classifier can replace this
// behind the same signature later without touching the orchestrator.
//
// Errs conservatively: on ambiguity → freshnessNeed "PERIODIC",
// privacyClass "public" — retrieval + the web-search gate handle the rest.

import type {
  Classification,
  AssistantIntent,
  FreshnessNeed,
  PrivacyClass,
} from "@/types/knowledge-loop";

// "current / latest / now" — the explicit freshness request.
const EXPLICIT_FRESHNESS =
  /\b(latest|today|now|currently|current|recent|recently|this week|this month|as of|up to date|up-to-date|news)\b/i;
// live/dynamic value words — a question whose ANSWER is a moving number.
const DYNAMIC_VALUE =
  /\b(price|quote|rate|cost|how much (is|does|are)|availability|in stock|market cap|exchange rate)\b/i;
// the user is asking about THEIR OWN account state.
const ACCOUNT_SPECIFIC =
  /\b(my (account|subscription|plan|order|purchase|licen[cs]e|invoice|billing|payment|receipt|card|email|profile|password)|refund me|cancel my|when (does|will) my|charged me|my last (payment|invoice|order))\b/i;
// PII / secrets in the message itself.
const SENSITIVE =
  /(\bsk-[a-z0-9]{8,}|bearer\s+[a-z0-9._-]{16,}|-----BEGIN|\b\d{13,19}\b(?![.\d])|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\b\d{3}-\d{2}-\d{4}\b)/i;
const HOW_TO =
  /\b(how (do|can|to|would) i|how to|steps? to|guide to|walk me through|set up|configure|enable|connect|where (do|can) i|where is)\b/i;
const POLICY =
  /\b(terms of service|terms and conditions|\bt&c\b|refund policy|cancellation policy|privacy policy|disclaimer|data (handling|retention|policy)|acceptable use)\b/i;
const SUPPORT_TROUBLE =
  /\b(error|not working|doesn'?t work|isn'?t working|failed|failing|can'?t (log|sign|connect|load|open|see)|bug|broken|stuck|crash|blank (screen|page)|won'?t (load|open|start)|502|500|timeout)\b/i;
const CONCEPTUAL =
  /\b(what (is|are|does|do)|explain|explanation of|difference between|meaning of|define|definition of|how does .* work|why (is|are|does|do))\b/i;
const PRODUCT =
  /\b(does (the|your|this) (ea|indicator|product|bot|system)|what (features|indicators)|is there (a|an) .* (feature|tool|indicator)|supported? (platform|broker|pair)|which (ea|product|indicator))\b/i;

export function classify(message: string): Classification {
  const m = (message ?? "").trim();

  const explicitFreshnessRequest = EXPLICIT_FRESHNESS.test(m);

  let privacyClass: PrivacyClass = "public";
  if (SENSITIVE.test(m)) privacyClass = "sensitive";
  else if (ACCOUNT_SPECIFIC.test(m)) privacyClass = "user-specific";

  let intent: AssistantIntent = "other";
  if (ACCOUNT_SPECIFIC.test(m)) intent = "account-specific";
  else if (explicitFreshnessRequest || DYNAMIC_VALUE.test(m)) intent = "current-info";
  else if (POLICY.test(m)) intent = "policy";
  else if (SUPPORT_TROUBLE.test(m)) intent = "support-troubleshoot";
  else if (HOW_TO.test(m)) intent = "how-to";
  else if (PRODUCT.test(m)) intent = "product-static";
  else if (CONCEPTUAL.test(m)) intent = "conceptual";

  let freshnessNeed: FreshnessNeed;
  if (DYNAMIC_VALUE.test(m) || (explicitFreshnessRequest && intent === "current-info")) {
    freshnessNeed = "DYNAMIC";
  } else if (intent === "conceptual" || intent === "how-to") {
    freshnessNeed = "STATIC";
  } else {
    freshnessNeed = "PERIODIC"; // conservative default (product/policy/support/other)
  }

  return { intent, freshnessNeed, privacyClass, explicitFreshnessRequest };
}
