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
// NOT wired into the live Gemini presenter this sprint - AIIntelligencePresenter
// .present(envelope, userQuestion) is a documented "permanent architectural
// rule" (types/intelligence-envelope.ts's own header) taking ONLY an
// IntelligenceEnvelope, and IntelligenceEnvelope is D2.5.5's own protected
// OHLC/quote-centric verified-fact model this sprint must not redesign.
// Actually feeding this text into a live LLM call is therefore a distinct,
// larger decision (extending a protected interface, or building a new
// wrapping layer) left to a future, separately-scoped sprint - see the
// D2.8.7 spec doc's "known limitations". This function exists so that
// decision can be made later without re-deriving the safety property from
// scratch.
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
 */
export function formatMicrostructureEvidence(snapshot: MicrostructureSnapshot): string[] {
  const lines: string[] = [
    "Microstructure Evidence:",
    `Provider: ${snapshot.provider}`,
    `Instrument: ${snapshot.symbol}`,
    `Freshness: ${snapshot.freshnessStatus}`,
    "",
    formatField("Bid", snapshot.evidence.bid),
    formatField("Ask", snapshot.evidence.ask),
    formatField("Spread", snapshot.derived.spread),
    formatField("Mid price", snapshot.derived.midPrice),
    "",
    "Order Book:",
    formatField("Bid depth", snapshot.derived.bidDepth),
    formatField("Ask depth", snapshot.derived.askDepth),
    formatField("Depth imbalance", snapshot.derived.depthImbalance),
    formatField("Liquidity concentration (this venue only)", snapshot.derived.liquidityConcentration),
    "",
    "Trade Flow:",
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
