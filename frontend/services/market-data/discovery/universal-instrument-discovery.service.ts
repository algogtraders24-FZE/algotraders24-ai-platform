// services/market-data/discovery/universal-instrument-discovery.service.ts
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. The orchestrator implementing the sprint's own CORE FLOW:
//
//   query -> search existing canonical catalog (InstrumentSearchService,
//            D2.6.3, unmodified ranking logic reused verbatim)
//         -> when insufficient, search provider-discovered instruments
//            (the 4 discovery services in this folder, in parallel,
//            each individually time-boxed and failure-isolated)
//         -> normalize + register each genuinely new candidate into the
//            SAME catalog (lib/market-data/instrument-catalog.ts's
//            additive DISCOVERED registry - no second registry)
//         -> re-run the SAME catalog search so ranking is uniform
//         -> attach the real capability matrix + chart resolution
//            (lib/market-data/chart-instrument-resolver.ts, the one
//            chart layer, extended - never duplicated here)
//
// This file contains NO ranking logic of its own (InstrumentSearchService
// owns that, unmodified) and NO chart-symbol logic of its own
// (chart-instrument-resolver.ts owns that). It is purely a composition +
// identity/registration boundary - the same "reuse, never duplicate"
// discipline every D2.6.x sprint in this program has followed.
import { InstrumentSearchService, type InstrumentSearchResult } from "@/services/market-data/instrument-search.service";
import { getCanonicalInstrument, mappingsForProvider, registerDiscoveredInstrument } from "@/lib/market-data/instrument-catalog";
import { resolveChartInstrument } from "@/lib/market-data/chart-instrument-resolver";
import { BinanceInstrumentDiscoveryService } from "./binance-instrument-discovery.service";
import { AngelOneInstrumentDiscoveryService } from "./angel-one-instrument-discovery.service";
import { TwelveDataInstrumentDiscoveryService } from "./twelve-data-instrument-discovery.service";
import { AlphaVantageInstrumentDiscoveryService } from "./alpha-vantage-instrument-discovery.service";
import type { DiscoveredCandidate, ProviderDiscoveryResult } from "@/types/instrument-discovery";
import type { CanonicalInstrument } from "@/types/canonical-instrument";
import { systemClock, type Clock } from "@/lib/market-data/cache";

// A catalog search this confident already answers the query well - no
// reason to pay for a live provider round trip. Never blocks the
// workspace: this is purely an early-exit, not a required step.
const SUFFICIENT_MATCH_TYPES = new Set(["exact-canonical", "exact-provider-symbol", "exact-display-name", "exact-alias"]);
const MIN_QUERY_LENGTH_FOR_DISCOVERY = 2;
const DEFAULT_LIMIT = 20;
const DISCOVERY_TIMEOUT_MS = 3_000;

export interface DiscoverableProvider {
  readonly name: string;
  search(query: string): Promise<ProviderDiscoveryResult>;
}

export interface UniversalInstrumentCapabilities {
  quote: boolean;
  candles: boolean;
  /** Mirrors `quote` today - a real snapshot is the minimum the deterministic pipeline needs to produce any intelligence at all. Kept as its own named field per this sprint's explicit "these must remain separate" instruction, not silently collapsed into `quote` at the call site. */
  intelligence: boolean;
  chart: boolean;
}

export interface UniversalSearchResultItem {
  id: string;
  symbol: string;
  displayName: string;
  assetClass: string;
  marketCategory?: string;
  exchange?: string;
  country?: string;
  currency?: string;
  matchType: string;
  /** The provider that discovered this instrument at runtime - undefined for a hand-curated catalog entry. */
  discoverySource?: string;
  providers: { provider: string; providerSymbol: string; capabilities: string[]; verified: boolean }[];
  capabilities: UniversalInstrumentCapabilities;
  chart: { supported: boolean; chartSymbol?: string; reason?: string };
}

export interface UniversalSearchDiagnostics {
  discoveryTriggered: boolean;
  providersQueried: string[];
  providersFailed: string[];
  providersStale: string[];
}

export interface UniversalSearchResponse {
  results: UniversalSearchResultItem[];
  diagnostics: UniversalSearchDiagnostics;
}

export interface UniversalInstrumentDiscoveryDeps {
  catalogSearch?: InstrumentSearchService;
  binance?: DiscoverableProvider;
  angelOne?: DiscoverableProvider;
  twelveData?: DiscoverableProvider;
  alphaVantage?: DiscoverableProvider;
  clock?: Clock;
  /** Injectable for tests only - production always uses DISCOVERY_TIMEOUT_MS. */
  discoveryTimeoutMs?: number;
}

export class UniversalInstrumentDiscoveryService {
  private readonly catalogSearch: InstrumentSearchService;
  private readonly providers: DiscoverableProvider[];
  private readonly clock: Clock;
  private readonly discoveryTimeoutMs: number;

  constructor(deps: UniversalInstrumentDiscoveryDeps = {}) {
    this.catalogSearch = deps.catalogSearch ?? new InstrumentSearchService();
    this.clock = deps.clock ?? systemClock;
    this.discoveryTimeoutMs = deps.discoveryTimeoutMs ?? DISCOVERY_TIMEOUT_MS;
    this.providers = [
      deps.binance ?? new BinanceInstrumentDiscoveryService({ clock: this.clock }),
      deps.angelOne ?? new AngelOneInstrumentDiscoveryService({ clock: this.clock }),
      deps.twelveData ?? new TwelveDataInstrumentDiscoveryService({ clock: this.clock }),
      deps.alphaVantage ?? new AlphaVantageInstrumentDiscoveryService({ clock: this.clock }),
    ];
  }

  async search(rawQuery: string, limit: number = DEFAULT_LIMIT): Promise<UniversalSearchResponse> {
    const query = rawQuery.trim();
    const diagnostics: UniversalSearchDiagnostics = { discoveryTriggered: false, providersQueried: [], providersFailed: [], providersStale: [] };
    if (!query) return { results: [], diagnostics };

    let catalogResults = this.catalogSearch.search(query, limit);
    const sufficient = catalogResults.length >= limit || catalogResults.some((r) => SUFFICIENT_MATCH_TYPES.has(r.matchType));

    if (!sufficient && query.length >= MIN_QUERY_LENGTH_FOR_DISCOVERY) {
      diagnostics.discoveryTriggered = true;
      const providerResults = await Promise.all(this.providers.map((p) => this.withTimeout(p, query)));
      for (const result of providerResults) {
        diagnostics.providersQueried.push(result.provider);
        if (result.failed) diagnostics.providersFailed.push(result.provider);
        if (result.stale) diagnostics.providersStale.push(result.provider);
        for (const candidate of result.candidates) this.registerCandidate(candidate);
      }
      // Re-run the SAME ranking logic now that new instruments exist in
      // the shared catalog - never a second, parallel ranking pass.
      catalogResults = this.catalogSearch.search(query, limit);
    }

    return { results: catalogResults.map((r) => this.toResultItem(r)), diagnostics };
  }

  /**
   * Deterministic identity + registration. Never merges by name
   * similarity: a candidate is only ever treated as "the same
   * instrument" as something already in the catalog when its exact
   * providerSymbol/providerInstrumentId already appears in that
   * provider's own real mappings - otherwise it gets its own,
   * provider-scoped synthetic id (`disc:<provider>:<symbolOrToken>`)
   * that can never collide with a different provider's discovery of a
   * similarly-named instrument.
   */
  private registerCandidate(candidate: DiscoveredCandidate): void {
    if (!candidate.providerSymbol) return;
    const alreadyMapped = mappingsForProvider(candidate.provider).some(
      ({ mapping }) =>
        mapping.providerSymbol === candidate.providerSymbol ||
        (candidate.providerInstrumentId !== undefined && mapping.providerInstrumentId === candidate.providerInstrumentId),
    );
    if (alreadyMapped) return;

    const id = `disc:${candidate.provider}:${candidate.providerInstrumentId ?? candidate.providerSymbol}`;
    if (getCanonicalInstrument(id)) return;

    const instrument: CanonicalInstrument = {
      id,
      symbol: candidate.providerSymbol,
      displayName: candidate.displayName,
      assetClass: candidate.assetClass,
      marketCategory: candidate.marketCategory,
      exchange: candidate.exchange,
      country: candidate.country,
      currency: candidate.currency,
      aliases: [],
      // Always attached, even when candidate.capabilities is empty
      // (Twelve Data/Alpha Vantage discovery, per those services' own
      // "discovery-only" contract) - an empty supportedCapabilities array
      // already honestly signals "no live market-data capability" to
      // every capability check in this codebase (mappingsForProvider()
      // callers filter on `.supportedCapabilities.includes(...)`, never
      // on array presence alone). Dropping the mapping entirely instead
      // would ALSO destroy the real, discovered providerSymbol/exchange
      // chart-instrument-resolver.ts needs to derive a chart symbol -
      // chart support and market-data support are deliberately
      // independent (this sprint's own "these capabilities must remain
      // separate" rule), so losing one must never silently take the
      // other down with it.
      providerMappings: [
        {
          provider: candidate.provider,
          providerSymbol: candidate.providerSymbol,
          providerInstrumentId: candidate.providerInstrumentId,
          supportedCapabilities: candidate.capabilities,
          // Discovered, not hand-verified against a live call by a
          // human this session - honestly false, matching this
          // codebase's `verified` contract (types/canonical-instrument.ts)
          // rather than claiming a confirmation that didn't happen.
          verified: false,
        },
      ],
      discovery: { source: candidate.provider, discoveredAt: new Date(this.clock.now()).toISOString() },
    };
    registerDiscoveredInstrument(instrument);
  }

  private toResultItem(result: InstrumentSearchResult): UniversalSearchResultItem {
    const instrument = result.instrument;
    const quote = instrument.providerMappings.some((m) => m.supportedCapabilities.includes("quote"));
    const candles = instrument.providerMappings.some((m) => m.supportedCapabilities.includes("candles"));
    const chart = resolveChartInstrument(instrument.id);
    return {
      id: instrument.id,
      symbol: instrument.symbol,
      displayName: instrument.displayName,
      assetClass: instrument.assetClass,
      marketCategory: instrument.marketCategory,
      exchange: instrument.exchange,
      country: instrument.country,
      currency: instrument.currency,
      matchType: result.matchType,
      discoverySource: instrument.discovery?.source,
      providers: instrument.providerMappings.map((m) => ({
        provider: m.provider,
        providerSymbol: m.providerSymbol,
        capabilities: m.supportedCapabilities,
        verified: m.verified,
      })),
      capabilities: { quote, candles, intelligence: quote, chart: chart.supported },
      chart: { supported: chart.supported, chartSymbol: chart.chartSymbol, reason: chart.reason },
    };
  }

  private async withTimeout(provider: DiscoverableProvider, query: string): Promise<ProviderDiscoveryResult> {
    try {
      return await Promise.race([
        provider.search(query),
        new Promise<ProviderDiscoveryResult>((_, reject) => {
          setTimeout(() => reject(new Error("discovery timed out")), this.discoveryTimeoutMs);
        }),
      ]);
    } catch (error) {
      return { provider: provider.name, candidates: [], stale: false, failed: true, reason: error instanceof Error ? error.message : "discovery failed" };
    }
  }
}
