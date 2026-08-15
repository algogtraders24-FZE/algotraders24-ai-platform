// types/microstructure-capability.ts
// Sprint D2.8.5, Phase 6 - a provider-neutral capability registry,
// deliberately separate from types/canonical-instrument.ts's
// MarketDataCapability ("quote" | "candles"). That union is a per-
// INSTRUMENT provider-routing contract (which providers may serve which
// symbol) and stays exactly as D2.6.3 defined it - unextended, per this
// sprint's "do not redesign MarketSnapshot unnecessarily" instruction.
// This is a different, per-PROVIDER capability declaration answering "has
// this provider's microstructure support actually been confirmed", not
// "which provider may I route this symbol to".
export type MicrostructureCapability =
  | "OHLC"
  | "VOLUME"
  | "BID_ASK"
  | "TICK_TRADES"
  | "AGGRESSOR_SIDE"
  | "ORDER_BOOK"
  | "ORDER_BOOK_DEPTH"
  | "HISTORICAL_TICKS"
  | "HISTORICAL_ORDER_BOOK";

/**
 * - "confirmed": actually runtime-verified with real evidence this platform recorded (a live call, a real payload capture) - never claimed on documentation alone.
 * - "not_verified": the provider's own documentation describes this capability, but no runtime evidence exists yet (missing/expired credentials, or simply not yet exercised).
 * - "unavailable": actively confirmed absent - the provider's documented API has no equivalent field/endpoint.
 * - "research_only": documentation-only audit with no account/credentialed access attempted at all (Dukascopy's status after D2.8.4 - no account was created, per that sprint's own scope).
 */
export type ProviderCapabilityVerification = "confirmed" | "not_verified" | "unavailable" | "research_only";

export interface ProviderMicrostructureCapabilities {
  provider: string;
  capabilities: Record<MicrostructureCapability, ProviderCapabilityVerification>;
  /** Which prior sprint(s) established this row's evidence - never a bare, unattributed claim. */
  evidenceSource: string;
}
