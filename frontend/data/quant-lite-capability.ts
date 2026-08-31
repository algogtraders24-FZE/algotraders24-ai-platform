/**
 * Q1.0 Part 11 - the single typed capability contract for Quant Lite real
 * execution, shared between the backend validation gate
 * (services/quant-lite/backend/dataCoverage.ts) and the Builder UI's
 * symbol/timeframe selectors (app/quant-lite/builder/StrategyBuilderForm.tsx).
 * Nothing else should hardcode a symbol/timeframe support list - import
 * this instead, so backend enforcement and UI display can never drift
 * apart.
 *
 * Every entry here is backed by a real, live-run engine test this
 * sprint, not inferred from the presence of rows in market.db:
 *   - Symbols: quant-engine/scripts/q10_symbol_sweep.py (2 independent
 *     strategies x 2 runs each, at 1h, real market.db data)
 *   - Timeframes: quant-engine/scripts/q10_timeframe_sweep.py (2
 *     independent strategies x 2 runs each, on the representative
 *     XAUUSD_EXNESS symbol, across all 7 candidate signal timeframes)
 * Full results: quant-engine/reports/Q1.0_CAPABILITY_MATRIX.md.
 *
 * Timeframe support is proven on one representative symbol and then
 * applied across all SUPPORTED/CONDITIONALLY_SUPPORTED symbols, because
 * timeframe compatibility is an execution_mtf.py mechanics property
 * (indicators/interpreter are symbol-agnostic - confirmed by reading the
 * engine source, Q0.9_EXISTING_EXECUTION_PATH.md), not a per-symbol one;
 * symbol coverage is a real-data-availability property, tested directly
 * per symbol. This is documented reasoning, not a hidden shortcut - see
 * Q1.0_CAPABILITY_MATRIX.md "Methodology".
 */

export const ALL_VERIFIED_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;

export interface CapabilityEntry {
  symbol: string;
  label: string;
  dataSource: string;
  /** Real min/max timestamp range found in market.db (Q1.0_DATA_COVERAGE_AUDIT.md) - NOT a claim of continuous coverage, see dataQualityWarning. */
  availableRange: { start: string; end: string };
  timeframes: readonly string[];
  status: "SUPPORTED" | "CONDITIONALLY_SUPPORTED";
  /** Set only for symbols with real, located gaps large/frequent enough to warrant a standing disclosure beyond the per-request gap warning. */
  dataQualityWarning?: string;
}

export const QUANT_LITE_CAPABILITY: CapabilityEntry[] = [
  {
    symbol: "XAUUSD_EXNESS",
    label: "Gold (XAUUSD) - Exness",
    dataSource: "Real Exness tick data",
    availableRange: { start: "2024-01-01", end: "2026-05-31" },
    timeframes: ALL_VERIFIED_TIMEFRAMES,
    status: "SUPPORTED",
  },
  {
    symbol: "EURUSD_EXNESS",
    label: "Euro/US Dollar (EURUSD) - Exness",
    dataSource: "Real Exness tick data",
    availableRange: { start: "2024-01-01", end: "2026-08-21" },
    timeframes: ALL_VERIFIED_TIMEFRAMES,
    status: "SUPPORTED",
  },
  {
    symbol: "GBPUSD_EXNESS",
    label: "British Pound/US Dollar (GBPUSD) - Exness",
    dataSource: "Real Exness tick data",
    availableRange: { start: "2024-01-01", end: "2026-08-21" },
    timeframes: ALL_VERIFIED_TIMEFRAMES,
    status: "SUPPORTED",
  },
  {
    symbol: "USOIL_EXNESS",
    label: "US Crude Oil (USOIL) - Exness",
    dataSource: "Real Exness tick data",
    availableRange: { start: "2024-01-01", end: "2026-08-21" },
    timeframes: ALL_VERIFIED_TIMEFRAMES,
    status: "SUPPORTED",
  },
  {
    symbol: "BTCUSD_EXNESS",
    label: "Bitcoin (BTCUSD) - Exness",
    dataSource: "Real Exness tick data",
    availableRange: { start: "2024-01-01", end: "2026-08-22" },
    timeframes: ALL_VERIFIED_TIMEFRAMES,
    status: "CONDITIONALLY_SUPPORTED",
    dataQualityWarning:
      "Over 60% of this symbol's nominal date range has no data at all (real gaps of 155, 216, 74, and 13 days). Backtests will silently use only the real data on either side of these gaps - always check the specific date range you request.",
  },
  {
    symbol: "XAUUSD_ZS_EXNESS",
    label: "Gold Zero-Spread (XAUUSD) - Exness",
    dataSource: "Real Exness tick data",
    availableRange: { start: "2024-01-01", end: "2026-08-02" },
    timeframes: ALL_VERIFIED_TIMEFRAMES,
    status: "CONDITIONALLY_SUPPORTED",
    dataQualityWarning:
      "This symbol has the most fragmented data of any supported symbol (38-40 real gaps, including several multi-week weekly-only stretches and a 130-day gap). Backtests will silently use only the real data available - always check the specific date range you request.",
  },
];
