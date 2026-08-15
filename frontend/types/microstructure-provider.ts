// types/microstructure-provider.ts
// Sprint D2.8.5 - an OPTIONAL, additive capability on top of the existing
// MarketDataProvider (types/market-data-provider.ts), following the exact
// pattern SnapshotProvider/TimeSeriesProvider already established there:
// a separate interface + a runtime duck-typed guard, so a provider that
// has no microstructure evidence (Twelve Data, Alpha Vantage, Angel One
// today) stays a fully valid MarketDataProvider without being forced to
// fabricate order-book/trade data it doesn't have. Deliberately NOT added
// to market-data-provider.ts itself - that file is a stable, shared
// contract every existing provider/consumer already depends on, and this
// sprint's own rule is "do not redesign MarketSnapshot unnecessarily";
// the same restraint applies to its sibling type file.
import type { MarketDataProvider, MarketContextRequest } from "./market-data-provider";
import type { RawMicrostructureResult } from "./microstructure";

export interface MicrostructureProvider {
  readonly name: string;
  isConfigured(): boolean;
  /**
   * Returns RAW evidence only - never a computed/derived value, never a
   * trading decision. The deterministic calculation layer (services/
   * microstructure/microstructure-calculation.service.ts) is solely
   * responsible for turning this into spread/depth/volume-delta/etc.
   */
  getMicrostructureSnapshot(request: MarketContextRequest): Promise<RawMicrostructureResult>;
}

export function isMicrostructureProvider(value: MarketDataProvider): value is MarketDataProvider & MicrostructureProvider {
  return typeof (value as Partial<MicrostructureProvider>).getMicrostructureSnapshot === "function";
}
