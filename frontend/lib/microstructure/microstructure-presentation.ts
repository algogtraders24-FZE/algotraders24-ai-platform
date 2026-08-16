// lib/microstructure/microstructure-presentation.ts
// Sprint D2.8.7, Phase 9 - a pure, deterministic formatter proving the
// safety property Phase 9 requires: a serialization of MicrostructureSnapshot
// that always names its provider/instrument, always states freshness
// explicitly, and NEVER invents a value for a field that isn't
// "available"/"stale" - it prints the honest state word ("unavailable",
// "not_supported_by_provider", "invalid") instead, exactly the D2.5.5
// AIPresenterOrchestrator/AIResponseIntegrityService discipline this
// codebase already enforces elsewhere ("Volume delta: unavailable", never
// "Volume delta: neutral").
//
// Sprint D2.8.8 - wired into the live presenter layer, additively. The
// locked AIIntelligencePresenter.present(envelope, userQuestion) signature
// (types/intelligence-envelope.ts's own header: a "permanent architectural
// rule") is NEVER touched or extended - instead, AIPresenterOrchestratorService
// (services/intelligence/chat/ai-presenter-orchestrator.service.ts, D2.6.8,
// not the locked interface itself) enriches the `userQuestion` STRING it
// forwards to each candidate presenter via buildPresenterQuestionWithMicrostructure()
// below, before that string ever reaches a presenter. Every individual
// presenter implementation is unmodified and remains unaware this ever
// happens - it just receives a longer, still-plain-string userQuestion.
import type { MicrostructureField, MicrostructureSnapshot } from "@/types/microstructure";

function formatField(label: string, field: MicrostructureField<number>, unit = ""): string {
  if (field.state === "available" || field.state === "stale") {
    const suffix = field.state === "stale" ? " (stale)" : "";
    return `${label}: ${field.value}${unit}${suffix}`;
  }
  // Every non-available state prints its own honest word - never a
  // guessed number, never "neutral", never "0".
  return `${label}: ${field.state}`;
}

/**
 * Renders a MicrostructureSnapshot as attributed, evidence-preserving text
 * lines - the exact shape Phase 9's own example specifies. Pure: identical
 * input always produces identical output, no I/O, no randomness.
 *
 * Sprint D2.8.8, Phase 4 - fields are grouped under explicit "Direct
 * Evidence" (reported directly by the provider: bid/ask) vs "Derived
 * Evidence" (computed by D2.8.5's own calculation layer from that raw
 * evidence: spread, mid-price, depth, imbalance, concentration, buy/sell
 * volume, volume delta) headings, so a reader/model can never mistake a
 * computed value for something the provider itself reported.
 */
export function formatMicrostructureEvidence(snapshot: MicrostructureSnapshot): string[] {
  const lines: string[] = [
    "Microstructure Evidence:",
    `Provider: ${snapshot.provider}`,
    `Instrument: ${snapshot.symbol}`,
    `Freshness: ${snapshot.freshnessStatus}`,
    "",
    `Direct Evidence (reported directly by ${snapshot.provider}):`,
    formatField("Bid", snapshot.evidence.bid),
    formatField("Ask", snapshot.evidence.ask),
    "",
    "Derived Evidence (computed from the direct evidence above - never independently reported by the provider):",
    formatField("Spread", snapshot.derived.spread),
    formatField("Mid price", snapshot.derived.midPrice),
    formatField("Bid depth", snapshot.derived.bidDepth),
    formatField("Ask depth", snapshot.derived.askDepth),
    formatField("Depth imbalance", snapshot.derived.depthImbalance),
    formatField("Liquidity concentration (this venue only)", snapshot.derived.liquidityConcentration),
    formatField("Buy volume", snapshot.derived.buyVolume),
    formatField("Sell volume", snapshot.derived.sellVolume),
    formatField("Volume delta", snapshot.derived.volumeDelta),
    "",
    // Explicit, permanent reminder this evidence is venue-specific - never
    // presented as a global/all-exchange market fact (D2.8.2's own rule,
    // reused verbatim here rather than re-derived).
    `Evidence scope: ${snapshot.provider} ${snapshot.symbol} order book only - not global market liquidity.`,
  ];
  return lines;
}

/**
 * Sprint D2.8.8, Phase 7 - wraps formatMicrostructureEvidence()'s honest
 * evidence lines with an explicit LLM safety boundary: what this block is
 * (real evidence, not a prediction), what it is NOT (global/institutional/
 * CME/spot+futures/global-FX/XAUUSD liquidity), and how to treat fields
 * that are not "available"/"stale" (report the state, never infer a
 * number). This text is never itself sent as a system instruction (the
 * locked GeminiIntelligencePresenter's own GEMINI_PRESENTER_SYSTEM_INSTRUCTION
 * is untouched) - it travels inside the user-turn content via
 * buildPresenterQuestionWithMicrostructure() below, so every candidate
 * presenter (Gemini/Claude/OpenAI) receives the identical safety framing
 * without any of their own code changing.
 */
export function buildMicrostructureLLMEvidenceBlock(snapshot: MicrostructureSnapshot): string {
  const evidenceLines = formatMicrostructureEvidence(snapshot).join("\n");
  return [
    "ADDITIONAL VERIFIED EVIDENCE - MARKET MICROSTRUCTURE",
    "(this is real, provider-attributed evidence you may cite as fact - it is not part of the trader's question above)",
    "",
    evidenceLines,
    "",
    "Rules for the evidence block above:",
    `- Venue-specific only: this is ${snapshot.provider} ${snapshot.symbol} order-book/trade evidence. Never describe it as global crypto liquidity, institutional liquidity, CME liquidity, combined spot+futures liquidity, global FX liquidity, or XAUUSD/any other instrument's liquidity.`,
    "- This is evidence, not a prediction, signal, or trading recommendation.",
    '- Any field stated as "unavailable", "stale", "invalid", or "not_supported_by_provider" must be reported using that exact word - never estimate, infer, or guess a replacement number.',
    `- Volume delta (when available) is derived from ${snapshot.provider}'s real aggressor-side flag on individual trades - it is measured, not estimated.`,
    "- If this evidence block is absent from a message, that does not imply neutral or balanced market conditions - it means no venue-specific microstructure evidence was requested or available for that analysis.",
  ].join("\n");
}

/**
 * Sprint D2.8.8, Phase 3 - the smallest possible bridge from
 * VerifiedRealTimeIntelligenceContext.microstructure to the presenter
 * layer: pure string composition, zero I/O. Returns `userQuestion`
 * completely unchanged (byte-identical) when `microstructure` is absent -
 * every existing caller that never opts into microstructure sees zero
 * behavior change.
 */
export function buildPresenterQuestionWithMicrostructure(userQuestion: string, microstructure?: MicrostructureSnapshot): string {
  if (!microstructure) return userQuestion;
  return `${userQuestion}\n\n${buildMicrostructureLLMEvidenceBlock(microstructure)}`;
}

/**
 * Sprint D2.8.8 - real, "available"/"stale" numeric values only (never a
 * value from an unavailable/invalid/not_supported_by_provider field),
 * extracted so AIResponseIntegrityService's existing unsupported-numeric-
 * claim checker (services/intelligence/chat/ai-response-integrity.service.ts)
 * can recognize a real microstructure number an LLM legitimately cited as
 * supported, rather than misclassifying honest evidence as a fabricated
 * claim. Order/duplicates are irrelevant to that checker's set-membership
 * use, so this simply visits every field once.
 */
export function collectMicrostructureRealNumbers(snapshot: MicrostructureSnapshot): number[] {
  const values: number[] = [];
  const collect = (field: MicrostructureField<number>): void => {
    if ((field.state === "available" || field.state === "stale") && typeof field.value === "number") {
      values.push(field.value);
    }
  };
  collect(snapshot.evidence.bid);
  collect(snapshot.evidence.ask);
  collect(snapshot.derived.midPrice);
  collect(snapshot.derived.spread);
  collect(snapshot.derived.bidDepth);
  collect(snapshot.derived.askDepth);
  collect(snapshot.derived.depthImbalance);
  collect(snapshot.derived.liquidityConcentration);
  collect(snapshot.derived.buyVolume);
  collect(snapshot.derived.sellVolume);
  collect(snapshot.derived.volumeDelta);
  return values;
}
