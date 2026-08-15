// lib/market-data/microstructure-capability-registry.ts
// Sprint D2.8.5, Phase 6 - a static, evidence-attributed registry of what
// each provider's microstructure capability is actually known to be,
// mirroring lib/market-data/instrument-catalog.ts's own "never added on
// assumption alone" discipline. Every row here traces to a specific prior
// sprint's real evidence (D2.6.6/D2.8.2/D2.8.3/D2.8.4) - never a fresh
// guess made while writing this file. A capability is "confirmed" ONLY
// when a real runtime call was made and recorded; documentation alone
// (however authoritative) is "not_verified" at best.
import type { MicrostructureCapability, ProviderCapabilityVerification, ProviderMicrostructureCapabilities } from "@/types/microstructure-capability";

function capabilities(entries: Partial<Record<MicrostructureCapability, ProviderCapabilityVerification>>): Record<MicrostructureCapability, ProviderCapabilityVerification> {
  const ALL: MicrostructureCapability[] = [
    "OHLC",
    "VOLUME",
    "BID_ASK",
    "TICK_TRADES",
    "AGGRESSOR_SIDE",
    "ORDER_BOOK",
    "ORDER_BOOK_DEPTH",
    "HISTORICAL_TICKS",
    "HISTORICAL_ORDER_BOOK",
  ];
  const full = {} as Record<MicrostructureCapability, ProviderCapabilityVerification>;
  for (const key of ALL) full[key] = entries[key] ?? "not_verified";
  return full;
}

export const MICROSTRUCTURE_CAPABILITY_REGISTRY: ProviderMicrostructureCapabilities[] = [
  {
    provider: "binance",
    capabilities: capabilities({
      OHLC: "confirmed",
      VOLUME: "confirmed",
      BID_ASK: "confirmed",
      TICK_TRADES: "confirmed",
      AGGRESSOR_SIDE: "confirmed",
      ORDER_BOOK: "confirmed",
      ORDER_BOOK_DEPTH: "confirmed",
      HISTORICAL_TICKS: "not_verified",
      HISTORICAL_ORDER_BOOK: "unavailable",
    }),
    evidenceSource: "D2.8.3 live runtime verification (real REST + WebSocket payloads for BTCUSDT/ETHUSDT) + D2.8.5's own live GET /depth and GET /trades calls in the Binance adapter",
  },
  {
    provider: "angel-one",
    capabilities: capabilities({
      OHLC: "confirmed",
      VOLUME: "unavailable",
      BID_ASK: "not_verified",
      TICK_TRADES: "not_verified",
      AGGRESSOR_SIDE: "unavailable",
      ORDER_BOOK: "not_verified",
      ORDER_BOOK_DEPTH: "not_verified",
      HISTORICAL_TICKS: "unavailable",
      HISTORICAL_ORDER_BOOK: "unavailable",
    }),
    evidenceSource: "D2.6.6 live OHLC/LTP verification (confirmed); D2.8.2 documentation research on Full/Depth-20 mode; D2.8.3 attempted runtime verification but AT24's own Angel One credentials were absent from the environment - remains not_verified until a future credentialed sprint",
  },
  {
    provider: "dukascopy",
    capabilities: capabilities({
      OHLC: "research_only",
      VOLUME: "research_only",
      BID_ASK: "research_only",
      TICK_TRADES: "research_only",
      AGGRESSOR_SIDE: "unavailable",
      ORDER_BOOK: "research_only",
      ORDER_BOOK_DEPTH: "research_only",
      HISTORICAL_TICKS: "research_only",
      HISTORICAL_ORDER_BOOK: "unavailable",
    }),
    evidenceSource: "D2.8.4 documentation-only research (official JForex/FIX API docs) - no account was created, no runtime call was ever made; ORDER_BOOK_DEPTH's live-only multi-level ITick fields are documented but AGGRESSOR_SIDE and HISTORICAL_ORDER_BOOK were confirmed structurally absent from Dukascopy's own documented interfaces",
  },
  {
    provider: "twelve-data",
    capabilities: capabilities({
      OHLC: "confirmed",
      VOLUME: "confirmed",
      BID_ASK: "unavailable",
      AGGRESSOR_SIDE: "unavailable",
      HISTORICAL_ORDER_BOOK: "unavailable",
    }),
    evidenceSource: "D2.2/D2.7.8 - quote/OHLC provider only, no tick/L2/L3 product exists at any documented tier (reconfirmed D2.8.2)",
  },
  {
    provider: "alpha-vantage",
    capabilities: capabilities({
      OHLC: "unavailable",
      VOLUME: "unavailable",
      BID_ASK: "confirmed",
      AGGRESSOR_SIDE: "unavailable",
      HISTORICAL_ORDER_BOOK: "unavailable",
    }),
    evidenceSource: "D2.8.1 - real EURUSD bid/ask confirmed live and wired into MarketSnapshot; spot-only, no OHLC/volume/tick/L2/L3 (reconfirmed D2.8.2)",
  },
];

export function getMicrostructureCapabilities(provider: string): ProviderMicrostructureCapabilities | undefined {
  return MICROSTRUCTURE_CAPABILITY_REGISTRY.find((entry) => entry.provider === provider);
}
