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

export const binanceMicrostructureProvider = new BinanceProvider();
export const microstructureSnapshots = new MicrostructureSnapshotService();
