// lib/market-data/chart-instrument-resolver.ts
// Sprint D2.6.11 - Universal Instrument Workspace, Dynamic Chart Resolution
// & Live Workspace Integration. The ONE deterministic mapping layer between
// a CanonicalInstrument (lib/market-data/instrument-catalog.ts, D2.6.3 - the
// single source of truth for "what is symbol X?") and the TradingView
// symbol that visualizes it. Fixes the D2.6.11 root-cause bug:
// components/workspace/tradingview/AdvancedChart.tsx previously carried its
// own separate, 7-entry hardcoded symbol map with a silent `?? "FX:EURUSD"`
// fallback for anything else - a second, incomplete symbol registry the
// chart used to decide what it could show, completely disconnected from the
// real catalog. That map is replaced by this module: every instrument in
// INSTRUMENT_CATALOG is intentionally classified here (a real TradingView
// symbol, or an honest `supported: false` with a reason) - never a silent
// substitution of a different instrument's chart.
//
// This resolver is presentation-only. TradingView never becomes a source of
// market intelligence (see docs/architecture/D2.6.11-universal-instrument-
// workspace-spec.md §4) - MarketSnapshot/MarketState/Regime/Hypothesis/
// Evidence/Risk/HistoricalValidation/IntelligenceScore all continue to come
// exclusively from MarketDataService's own provider-capability-filtered,
// smart-fallback path (D2.6.3/D2.6.4), entirely independent of this file.
//
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Still the ONE chart resolution layer - extended, never
// duplicated, so a runtime-discovered instrument (types/canonical-
// instrument.ts's `discovery` field present) also gets an honest
// resolution instead of silently falling through to "unsupported" just
// because it isn't one of the 16 hand-curated TRADINGVIEW_SYMBOL entries.
// deriveDiscoveredChartResolution() below applies a SECOND, still fully
// deterministic derivation using only real values a provider itself
// returned (its own `exchange` field, its own `providerSymbol`) - never a
// guess. An instrument this can't confidently derive a symbol for still
// returns `supported: false` with a reason - the exact same honest
// contract D2.6.11 established, never regressed by this extension.
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import type { CanonicalInstrument } from "@/types/canonical-instrument";

export interface ChartInstrumentResolution {
  canonicalSymbol: string;
  displaySymbol: string;
  chartProvider: "tradingview";
  /** The real TradingView exchange-prefixed symbol - present only when `supported` is true. Never a guessed/synthetic value. */
  chartSymbol?: string;
  exchange?: string;
  supported: boolean;
  /** Present only when `supported` is false - the deterministic, honest reason no chart representation exists. */
  reason?: string;
}

// Real, exchange-prefixed TradingView symbols, one explicit entry per
// INSTRUMENT_CATALOG member - never invented. Forex/metals/crypto entries
// mirror the exact symbols this chart already used successfully before this
// sprint (unchanged - "keep the existing TradingView widget"); the newly
// added crypto pairs (SOLUSD/XRPUSD) follow the same COINBASE: convention
// already proven for BTCUSD/ETHUSD rather than introducing a second
// exchange convention. Indian instruments use TradingView's real NSE:
// listings. AAPL uses TradingView's real NASDAQ: listing - the chart can
// honestly visualize it even though no configured intelligence provider
// serves it (chart is visualization, D2.6.11 §6/Part 6 - independent of
// MarketDataService coverage).
const TRADINGVIEW_SYMBOL: Record<string, string> = {
  EURUSD: "FX:EURUSD",
  GBPUSD: "FX:GBPUSD",
  USDJPY: "FX:USDJPY",
  XAUUSD: "OANDA:XAUUSD",
  XAGUSD: "OANDA:XAGUSD",
  BTCUSD: "COINBASE:BTCUSD",
  ETHUSD: "COINBASE:ETHUSD",
  SOLUSD: "COINBASE:SOLUSD",
  XRPUSD: "COINBASE:XRPUSD",
  NIFTY50: "NSE:NIFTY",
  BANKNIFTY: "NSE:BANKNIFTY",
  RELIANCE: "NSE:RELIANCE",
  TCS: "NSE:TCS",
  INFY: "NSE:INFY",
  HDFCBANK: "NSE:HDFCBANK",
  AAPL: "NASDAQ:AAPL",
};

// Exchange values a discovery source has itself returned (Angel One's
// exch_seg, Twelve Data's exchange field) mapped to TradingView's real,
// documented exchange prefix - only exchanges this project has confirmed
// TradingView actually publishes under this exact prefix. Never a guess:
// an exchange not listed here falls through to "unsupported" honestly.
const KNOWN_TRADINGVIEW_EXCHANGE_PREFIX: Record<string, string> = {
  NSE: "NSE",
  NASDAQ: "NASDAQ",
  NYSE: "NYSE",
};

/**
 * Discovered-instrument-only derivation (see file header). Applies real,
 * provider-reported values through a small set of deterministic,
 * documented rules - never a fabricated symbol, and never applied to a
 * hand-curated catalog entry (those are always resolved via
 * TRADINGVIEW_SYMBOL above first).
 */
function deriveDiscoveredChartResolution(instrument: CanonicalInstrument): ChartInstrumentResolution {
  const base = {
    canonicalSymbol: instrument.id,
    displaySymbol: instrument.displayName,
    chartProvider: "tradingview" as const,
    exchange: instrument.exchange,
  };
  const mapping = instrument.providerMappings[0];
  const source = instrument.discovery?.source;

  if (mapping) {
    if (source === "binance") {
      // TradingView's own documented BINANCE: exchange prefix for spot
      // pairs - the exact providerSymbol Binance itself returned, never
      // reformatted or guessed.
      return { ...base, chartSymbol: `BINANCE:${mapping.providerSymbol}`, supported: true };
    }
    if (instrument.exchange === "NSE" && instrument.assetClass === "equity") {
      // Angel One's real symbol format for a cash equity is
      // "<TICKER>-EQ" (confirmed live, see instrument-catalog.ts's
      // curated RELIANCE/TCS/INFY/HDFCBANK entries) - stripping the
      // fixed "-EQ" suffix recovers TradingView's real NSE ticker.
      // Indices are deliberately excluded here: their real TradingView
      // ticker does not reliably follow this same derivation (see the
      // already-curated NIFTY50/BANKNIFTY entries instead of guessing a
      // second one for a newly discovered index).
      const ticker = mapping.providerSymbol.replace(/-EQ$/i, "");
      return { ...base, chartSymbol: `NSE:${ticker}`, supported: true };
    }
    if (instrument.exchange) {
      const prefix = KNOWN_TRADINGVIEW_EXCHANGE_PREFIX[instrument.exchange.toUpperCase()];
      if (prefix) {
        return { ...base, chartSymbol: `${prefix}:${mapping.providerSymbol}`, supported: true };
      }
    }
  }

  return { ...base, supported: false, reason: "No deterministic TradingView chart representation could be derived for this discovered instrument." };
}

/**
 * Pure, deterministic: identical `id` always produces an identical
 * resolution. Never fabricates a chart symbol for an instrument not listed
 * above - an unknown or unmapped instrument honestly returns
 * `supported: false` with a reason, so the caller can render an explicit
 * "Chart visualization is unavailable" state instead of silently showing a
 * different instrument's chart.
 */
export function resolveChartInstrument(id: string): ChartInstrumentResolution {
  const instrument = getCanonicalInstrument(id);
  if (!instrument) {
    return {
      canonicalSymbol: id,
      displaySymbol: id,
      chartProvider: "tradingview",
      supported: false,
      reason: "This instrument is not in the canonical instrument catalog.",
    };
  }

  const chartSymbol = TRADINGVIEW_SYMBOL[instrument.id];
  if (chartSymbol) {
    return {
      canonicalSymbol: instrument.id,
      displaySymbol: instrument.displayName,
      chartProvider: "tradingview",
      chartSymbol,
      exchange: instrument.exchange,
      supported: true,
    };
  }

  if (instrument.discovery) {
    return deriveDiscoveredChartResolution(instrument);
  }

  return {
    canonicalSymbol: instrument.id,
    displaySymbol: instrument.displayName,
    chartProvider: "tradingview",
    exchange: instrument.exchange,
    supported: false,
    reason: "No TradingView chart representation is configured for this instrument yet.",
  };
}
