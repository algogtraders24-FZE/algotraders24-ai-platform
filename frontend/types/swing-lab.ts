// types/swing-lab.ts
// Swing Lab: a multi-timeframe trend and key-level map plus a swing position planner.
// Descriptive process tools, not signals: our own tests found no edge in the popular daily swing rules (docs/SWING-LAB-RD-2026-11-16.md).

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

export type SwingMapOverviewRow = { symbol: string; status: "ok"; data: SwingMapRow } | { symbol: string; status: "unavailable"; message: string };

export interface SwingMapOverview {
  rows: SwingMapOverviewRow[];
  /** Epoch ms when the rows were computed. */
  asOf: number;
}
