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
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";

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
  if (!chartSymbol) {
    return {
      canonicalSymbol: instrument.id,
      displaySymbol: instrument.displayName,
      chartProvider: "tradingview",
      exchange: instrument.exchange,
      supported: false,
      reason: "No TradingView chart representation is configured for this instrument yet.",
    };
  }

  return {
    canonicalSymbol: instrument.id,
    displaySymbol: instrument.displayName,
    chartProvider: "tradingview",
    chartSymbol,
    exchange: instrument.exchange,
    supported: true,
  };
}
