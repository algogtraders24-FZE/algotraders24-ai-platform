// lib/chart-engine/indicators/panel-registry.ts
// Sprint D2.7.3, Phase 8 - the reusable panel model. A panel is identified
// purely by ChartPanelId; this file only says which panels exist, their
// relative height weight, and a human label - it has no rendering code and
// no indicator-specific logic. A future indicator "registers" a panel
// simply by returning that panel id from computeIndicatorSeries() (see
// compute.ts) - no layout code anywhere needs to change.
//
// Colors are deliberately NOT a new palette (Phase 13: "do not introduce a
// separate visual language") - every default below reuses one of AT24's
// existing five design-token hues (app/globals.css: --gold/--gold-strong/
// --steel/--signal-up/--signal-down/--text-3), the same discipline D2.7.1's
// FIN_* typography tokens and D2.7.2's canvas-colors.ts already established.
// MACD's histogram and Volume's bars deliberately reuse --signal-up/-down -
// not a "borrowed" color for decoration, but the exact same bullish/bearish
// semantic those tokens already carry for candles (histogram > 0 / volume
// on an up candle = the same real meaning).
import type { ChartPanelId, IndicatorConfig } from "./types";

export interface PanelSpec {
  id: ChartPanelId;
  label: string;
  /** Relative height weight when this panel is active - the price panel always gets the largest share. Actual pixel heights are computed by panel-layout.ts from the chart's real, resized dimensions - never a hardcoded px value here. */
  heightWeight: number;
}

export const PANEL_REGISTRY: Record<ChartPanelId, PanelSpec> = {
  price: { id: "price", label: "Price", heightWeight: 3 },
  volume: { id: "volume", label: "Volume", heightWeight: 1 },
  rsi: { id: "rsi", label: "RSI", heightWeight: 1 },
  macd: { id: "macd", label: "MACD", heightWeight: 1 },
  atr: { id: "atr", label: "ATR", heightWeight: 1 },
  stochastic: { id: "stochastic", label: "Stochastic", heightWeight: 1 },
  adx: { id: "adx", label: "ADX", heightWeight: 1 },
  cci: { id: "cci", label: "CCI", heightWeight: 1 },
  "williams-r": { id: "williams-r", label: "Williams %R", heightWeight: 1 },
};

/** The default, deterministic indicator configurations the chart toolbar's Indicators menu offers - real periods matching TechnicalContextService's own existing choices (RSI-14, EMA-20/50, SMA-20, Bollinger-20/2, MACD-12/26/9) so a value shown on the chart always agrees with the same value the AI Intelligence panel would report for the same symbol/timeframe. ATR-14 matches TechnicalContextService's own ATR_PERIOD_DEFAULT (indicators.ts). Stochastic 5/3/3, ADX-14, CCI-14 and Williams %R-14 are all MT5's real verified defaults this session (mql5.com/metatrader5.com) - CCI's own original Lambert methodology used 20, but MT5 itself defaults to 14, same as the others. */
export const DEFAULT_INDICATOR_CONFIGS: readonly IndicatorConfig[] = [
  { id: "ema", key: "ema-20", period: 20, color: "var(--gold)" },
  { id: "ema", key: "ema-50", period: 50, color: "var(--gold-strong)" },
  { id: "sma", key: "sma-20", period: 20, color: "var(--steel)" },
  { id: "bollinger", key: "bollinger-20", period: 20, stdDevMultiplier: 2, color: "var(--text-3)" },
  { id: "rsi", key: "rsi-14", period: 14, color: "var(--gold)" },
  { id: "macd", key: "macd-12-26-9", period: 12, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, color: "var(--gold)" },
  { id: "volume", key: "volume", period: 20, color: "var(--steel)" },
  { id: "atr", key: "atr-14", period: 14, color: "var(--gold)" },
  { id: "stochastic", key: "stochastic-5-3-3", period: 5, slowingPeriod: 3, signalPeriod: 3, color: "var(--gold)" },
  { id: "adx", key: "adx-14", period: 14, color: "var(--gold)" },
  { id: "cci", key: "cci-14", period: 14, color: "var(--gold)" },
  { id: "williams-r", key: "williams-r-14", period: 14, color: "var(--gold)" },
];

// Sprint D2.7.5, Phase 4 - a static id->panel lookup so the toolbar's
// Indicators menu can group entries into "Overlays" (drawn on the price
// panel) vs "Panels" (their own sub-panel row) WITHOUT computing a real
// IndicatorSeries first (that requires real candle data the menu doesn't
// have). This mirrors - never duplicates the authority of -
// compute.ts's per-id `panel:` assignment in its switch statement; a
// dedicated regression test in validate-native-chart-workspace.ts computes
// a real series for every DEFAULT_INDICATOR_CONFIGS entry and asserts its
// actual `.panel` equals this table's entry for the same id, so the two can
// never silently drift apart.
export const INDICATOR_PANEL_ID: Record<IndicatorConfig["id"], ChartPanelId> = {
  sma: "price",
  ema: "price",
  bollinger: "price",
  rsi: "rsi",
  macd: "macd",
  volume: "volume",
  atr: "atr",
  stochastic: "stochastic",
  adx: "adx",
  cci: "cci",
  "williams-r": "williams-r",
};
