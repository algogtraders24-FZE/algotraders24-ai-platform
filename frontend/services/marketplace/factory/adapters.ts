// services/marketplace/factory/adapters.ts
// Sprint M9 - Platform adapter registry. MT5 is the only platform with a
// real evidence-ingestion adapter, because M2/M2.1 is the only one that
// exists (M9 brief section 4). Every other platform is registered with
// explicit, honest UNAVAILABLE capabilities - never fabricated support.
// No platform-specific field exists on the generic PlatformAdapter
// interface itself (types/marketplace-factory.ts) - MT5-only behavior
// lives only in mt5EvidenceAdapter.ts, never inside this registry's shape
// or inside the generic ingestion/eligibility/audit modules.
import type { PlatformAdapter, PlatformName } from "@/types/marketplace-factory";
import { mt5DiscoverEvidence } from "./mt5EvidenceAdapter";

// The five platforms with no evidence-ingestion adapter yet all share this
// literal - explicit, honest "nothing exists here", never a fabricated
// lookup.
const noEvidenceAdapter = async () => null;

const ADAPTERS: Record<PlatformName, PlatformAdapter> = {
  MT5: {
    platform: "MT5",
    productTypes: ["EA"],
    sourceFormats: ["mt5-deals-table-v1", "g01-research-csv-v1"],
    evidenceIngestionSupported: true,
    validationCapability: "AVAILABLE",
    requiredArtifacts: ["nativeReportHtm", "evidencePackageJson"],
    supportedMarkets: ["Gold", "Silver", "Forex", "Indices"],
    supportedTimeframes: ["M1", "M5", "M15", "H1", "H4", "D1"],
    discoverEvidence: mt5DiscoverEvidence,
  },
  MT4: {
    platform: "MT4",
    productTypes: ["EA"],
    sourceFormats: [],
    evidenceIngestionSupported: false,
    validationCapability: "UNAVAILABLE",
    requiredArtifacts: [],
    supportedMarkets: [],
    supportedTimeframes: [],
    discoverEvidence: noEvidenceAdapter,
  },
  cTrader: {
    platform: "cTrader",
    productTypes: ["cBot"],
    sourceFormats: [],
    evidenceIngestionSupported: false,
    validationCapability: "UNAVAILABLE",
    requiredArtifacts: [],
    supportedMarkets: [],
    supportedTimeframes: [],
    discoverEvidence: noEvidenceAdapter,
  },
  NinjaTrader: {
    platform: "NinjaTrader",
    productTypes: ["Strategy"],
    sourceFormats: [],
    evidenceIngestionSupported: false,
    validationCapability: "UNAVAILABLE",
    requiredArtifacts: [],
    supportedMarkets: [],
    supportedTimeframes: [],
    discoverEvidence: noEvidenceAdapter,
  },
  Crypto: {
    platform: "Crypto",
    productTypes: ["Trading Bot"],
    sourceFormats: [],
    evidenceIngestionSupported: false,
    validationCapability: "UNAVAILABLE",
    requiredArtifacts: [],
    supportedMarkets: [],
    supportedTimeframes: [],
    discoverEvidence: noEvidenceAdapter,
  },
  "AI Engine": {
    platform: "AI Engine",
    productTypes: ["AI Trading System"],
    sourceFormats: [],
    evidenceIngestionSupported: false,
    validationCapability: "UNAVAILABLE",
    requiredArtifacts: [],
    supportedMarkets: [],
    supportedTimeframes: [],
    discoverEvidence: noEvidenceAdapter,
  },
};

export function getAdapter(platform: string): PlatformAdapter | null {
  return (ADAPTERS as Record<string, PlatformAdapter>)[platform] ?? null;
}

export function listAdapters(): PlatformAdapter[] {
  return Object.values(ADAPTERS);
}
