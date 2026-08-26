// services/microstructure/shared-instance.ts
// Sprint D2.8.6 - the production-consumable microstructure boundary Phase 5
// asks this sprint to identify. Mirrors services/market-data/shared-
// instance.ts's existing, already-battle-tested pattern (D2.3 Phase 9)
// exactly: one shared instance, no new abstraction invented. This is
// deliberately NOT a merge into MarketSnapshot/MarketDataService - D2.8.2
// established that microstructure evidence is venue-specific, and mixing
// it into the OHLC/quote model would blur that distinction. A future
// consumer (a route, a script, or - explicitly NOT this sprint - an
// Intelligence layer) reaches real microstructure evidence through this
// file, never by constructing its own BinanceProvider/
// MicrostructureSnapshotService.
//
// Only Binance is exported here - the one provider D2.8.3/D2.8.6 have
// real runtime evidence for (see lib/market-data/microstructure-capability-
// registry.ts). Angel One and Dukascopy remain not_verified/research_only;
// adding them to this file is explicitly out of this sprint's scope.
import { BinanceProvider } from "@/lib/market-data/providers/binance.provider";
import { MicrostructureSnapshotService } from "./microstructure-snapshot.service";
import type { CanonicalInstrument } from "@/types/canonical-instrument";

export const binanceMicrostructureProvider = new BinanceProvider();
export const microstructureSnapshots = new MicrostructureSnapshotService();

// Post-completion note (2026-08-26) - live production investigation found
// the real Binance microstructure fetch (BTCUSD/ETHUSD, the only two
// genuinely Binance-capable instruments) consistently crashing the Vercel
// serverless function outright: a raw 502 from Cloudflare with ZERO Vercel
// involvement (no x-vercel-id header at all - the function never even
// returned a response), 100% reproducible across repeated live probes,
// distinct from every other route on this domain (which all return normal
// Vercel-stamped responses). Most plausibly Binance geo-blocking Vercel's
// IP range at a connection level our own try/catch can't intercept - the
// genuine root cause needs Vercel's own function logs (not accessible from
// this environment) to confirm definitively. Rather than keep showing
// users a permanently-broken "temporarily unavailable" state (which reads
// as a transient, retry-later condition it is not), this flag turns the
// capability off at its ONE shared source - every consumer (the live
// microstructure route, DecisionContext's missingInformation, and
// RealTimeIntelligenceService's chat-path fetch) then honestly reports
// "not supported for this instrument", the same clean state already shown
// for every non-Binance-capable symbol, instead of attempting a call known
// to crash. Flip back to false once the underlying crash is diagnosed and
// fixed - see the D2.7.11 roadmap doc's microstructure-crash note.
export const BINANCE_MICROSTRUCTURE_DISABLED = true;

/**
 * The one shared "is this instrument genuinely Binance-microstructure-
 * capable" check - reused by every real consumer instead of each
 * duplicating (and potentially drifting from) the same provider-mapping
 * lookup. Honors BINANCE_MICROSTRUCTURE_DISABLED above.
 */
export function isBinanceMicrostructureCapable(instrument: CanonicalInstrument | undefined): boolean {
  if (BINANCE_MICROSTRUCTURE_DISABLED) return false;
  return (instrument?.providerMappings ?? []).some(
    (m) => m.provider === binanceMicrostructureProvider.name && m.supportedCapabilities.includes("quote"),
  );
}
