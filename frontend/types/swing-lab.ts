// types/swing-lab.ts
// Swing Lab: a multi-timeframe trend and key-level map plus a swing position planner for forex pairs, metals, energy and stock indices.
// (Crypto lives in Crypto Flow.) Descriptive process tools, not signals: our own tests found no edge in the popular daily swing rules
// (docs/SWING-LAB-RD-2026-11-16.md). Data: the AT24 MT5 data bridge (Exness symbols), read-only.

export type SwingGroup = "forex" | "metals" | "energy" | "indices";
/** Currency the instrument's price is quoted in. "none" for the dollar index (not a tradable price per unit). */
export type SwingQuote = "USD" | "JPY" | "EUR" | "GBP" | "CAD" | "CHF" | "none";

export interface SwingInstrument {
  /** Bridge symbol, also the id used in the API. */
  symbol: string;
  short: string;
  label: string;
  group: SwingGroup;
  quote: SwingQuote;
  /** Base units in one standard lot, shown only for forex pairs. */
  lotUnits?: number;
}

export const SWING_GROUP_TITLE: Record<SwingGroup, string> = { forex: "Forex pairs", metals: "Metals", energy: "Energy", indices: "Stock indices and dollar index" };

export const SWING_INSTRUMENTS: readonly SwingInstrument[] = [
  { symbol: "EURUSD", short: "EURUSD", label: "Euro / US dollar", group: "forex", quote: "USD", lotUnits: 100_000 },
  { symbol: "GBPUSD", short: "GBPUSD", label: "Pound / US dollar", group: "forex", quote: "USD", lotUnits: 100_000 },
  { symbol: "USDJPY", short: "USDJPY", label: "US dollar / Yen", group: "forex", quote: "JPY", lotUnits: 100_000 },
  { symbol: "AUDUSD", short: "AUDUSD", label: "Australian dollar / US dollar", group: "forex", quote: "USD", lotUnits: 100_000 },
  { symbol: "NZDUSD", short: "NZDUSD", label: "New Zealand dollar / US dollar", group: "forex", quote: "USD", lotUnits: 100_000 },
  { symbol: "USDCAD", short: "USDCAD", label: "US dollar / Canadian dollar", group: "forex", quote: "CAD", lotUnits: 100_000 },
  { symbol: "USDCHF", short: "USDCHF", label: "US dollar / Swiss franc", group: "forex", quote: "CHF", lotUnits: 100_000 },
  { symbol: "EURJPY", short: "EURJPY", label: "Euro / Yen", group: "forex", quote: "JPY", lotUnits: 100_000 },
  { symbol: "GBPJPY", short: "GBPJPY", label: "Pound / Yen", group: "forex", quote: "JPY", lotUnits: 100_000 },
  { symbol: "AUDJPY", short: "AUDJPY", label: "Australian dollar / Yen", group: "forex", quote: "JPY", lotUnits: 100_000 },
  { symbol: "EURGBP", short: "EURGBP", label: "Euro / Pound", group: "forex", quote: "GBP", lotUnits: 100_000 },
  { symbol: "XAUUSD", short: "Gold", label: "Gold (XAUUSD)", group: "metals", quote: "USD" },
  { symbol: "XAGUSD", short: "Silver", label: "Silver (XAGUSD)", group: "metals", quote: "USD" },
  { symbol: "XCUUSD", short: "Copper", label: "Copper (XCUUSD)", group: "metals", quote: "USD" },
  { symbol: "USOIL", short: "WTI", label: "US crude oil (WTI)", group: "energy", quote: "USD" },
  { symbol: "UKOIL", short: "Brent", label: "Brent crude oil", group: "energy", quote: "USD" },
  { symbol: "US30", short: "US30", label: "Dow Jones 30", group: "indices", quote: "USD" },
  { symbol: "US500", short: "US500", label: "S&P 500", group: "indices", quote: "USD" },
  { symbol: "USTEC", short: "US100", label: "Nasdaq 100 (USTEC)", group: "indices", quote: "USD" },
  { symbol: "DE30", short: "DAX", label: "DAX 40 (DE30)", group: "indices", quote: "EUR" },
  { symbol: "JP225", short: "Nikkei", label: "Nikkei 225 (JP225)", group: "indices", quote: "JPY" },
  { symbol: "DXY", short: "DXY", label: "US dollar index", group: "indices", quote: "none" },
] as const;

export function getSwingInstrument(symbol: string): SwingInstrument | undefined {
  return SWING_INSTRUMENTS.find((i) => i.symbol === symbol);
}

export type SwingTrend = "up" | "down" | "mixed";
export type SwingAlignment = "aligned up" | "aligned down" | "mixed";

export interface SwingLevel {
  price: number;
  /** Distance from the price, percent (positive above, negative below). */
  distancePct: number;
  /** Distance in daily ATR(14) units (positive above, negative below). */
  distanceAtr: number;
  /** Where the level comes from. */
  source: "daily swing high" | "daily swing low" | "previous week high" | "previous week low" | "20-day high" | "20-day low";
}

export interface SwingMapRow {
  symbol: string;
  /** Last closed 4-hour close, the price the map is measured from. */
  price: number;
  /** Open time of that 4-hour bar, epoch ms (a stale value means the market is closed). */
  asOfBar: number;
  /** Daily ATR(14), percent of price. */
  atrPct: number;
  w1: SwingTrend | null;
  d1: SwingTrend | null;
  h4: SwingTrend | null;
  alignment: SwingAlignment;
  /** Nearest level above and below the price. */
  resistance: SwingLevel | null;
  support: SwingLevel | null;
  /** Position inside the last 50 daily bars' range, 0 (at the low) to 100 (at the high). */
  rangePosPct: number;
}

export type SwingMapOverviewRow =
  | { symbol: string; status: "ok"; data: SwingMapRow }
  /** not_connected: the data bridge has no such symbol yet. error: a temporary failure. */
  | { symbol: string; status: "unavailable"; reason: "not_connected" | "error"; message: string };

export interface SwingMapOverview {
  rows: SwingMapOverviewRow[];
  /** Epoch ms when the rows were computed. */
  asOf: number;
  /** Which source served the candles of this refresh (diagnostics). */
  source?: "exness" | "bridge" | "mixed" | "none";
  /** Whether the Exness API is switched on for this deployment and, per kind, why it did not serve requests. Diagnostics only. */
  exnessDiag?: { enabled: boolean; errors: Record<string, number>; sample?: string };
}

// ---- forward scoreboard (rules in services/swing-lab/scoreboard.ts) ----
export type SwingScoreVerdict = "COLLECTING" | "POSITIVE ON THIS HISTORY" | "NEGATIVE ON THIS HISTORY" | "NO EDGE SHOWN";

export interface SwingScoreRowDto {
  n: number;
  meanR: number | null;
  hitPct: number | null;
  t: number | null;
  verdict: SwingScoreVerdict;
  driftAtr: number | null;
  snapshots: number;
}

export interface SwingScoreboard {
  pooled: { up: SwingScoreRowDto; down: SwingScoreRowDto };
  groups: Array<{ group: string; up: SwingScoreRowDto; down: SwingScoreRowDto }>;
  rows: Array<{ symbol: string; up: SwingScoreRowDto; down: SwingScoreRowDto }>;
  open: number;
  done: number;
  since: string | null;
}
