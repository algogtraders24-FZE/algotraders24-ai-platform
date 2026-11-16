// types/market-board.ts
// Market Board: a live chart with AT24 indicators attached (Zone Pro, Divergence Pro), plus a market heatmap and a correlation shift table.
// Descriptive process tools, not signals. Data: Exness candles (Exness Trading API first, the AT24 MT5 data bridge as backup), read-only.
import type { CorrelationRow, OverviewRow, ShiftStatus, ZoneBoard, DivergenceBoard } from "@/services/market-board/indicators";
import type { AbsorptionBoard, FvgBoard, ObBoard, VpBoard } from "@/services/market-board/indicators-more";
import type { SetupBoard } from "@/services/market-board/indicators-setups";
import type { ErBoard, StructureBoard } from "@/services/market-board/indicators-structure";

export type BoardGroup = "metals" | "energy" | "forex" | "indices" | "crypto";

export interface BoardInstrument {
  symbol: string;
  short: string;
  label: string;
  group: BoardGroup;
}

export const BOARD_GROUP_TITLE: Record<BoardGroup, string> = { metals: "Metals", energy: "Energy", forex: "Forex", indices: "Indices", crypto: "Crypto" };

export const BOARD_INSTRUMENTS: readonly BoardInstrument[] = [
  { symbol: "XAUUSD", short: "Gold", label: "Gold (XAUUSD)", group: "metals" },
  { symbol: "XAGUSD", short: "Silver", label: "Silver (XAGUSD)", group: "metals" },
  { symbol: "USOIL", short: "WTI", label: "US crude oil (WTI)", group: "energy" },
  { symbol: "EURUSD", short: "EURUSD", label: "Euro / US dollar", group: "forex" },
  { symbol: "GBPUSD", short: "GBPUSD", label: "Pound / US dollar", group: "forex" },
  { symbol: "USDJPY", short: "USDJPY", label: "US dollar / Yen", group: "forex" },
  { symbol: "US500", short: "US500", label: "S&P 500", group: "indices" },
  { symbol: "USTEC", short: "USTEC", label: "Nasdaq 100", group: "indices" },
  { symbol: "US30", short: "US30", label: "Dow Jones 30", group: "indices" },
  { symbol: "BTCUSD", short: "Bitcoin", label: "Bitcoin (BTCUSD)", group: "crypto" },
  { symbol: "ETHUSD", short: "Ether", label: "Ether (ETHUSD)", group: "crypto" },
];

export function getBoardInstrument(symbol: string): BoardInstrument | undefined {
  return BOARD_INSTRUMENTS.find((i) => i.symbol === symbol);
}

/** Correlation pairs shown on the board (the same defaults as the MT5 Correlation Shift Monitor). */
export const BOARD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["XAUUSD", "EURUSD"],
  ["XAUUSD", "US500"],
  ["XAUUSD", "USOIL"],
  ["BTCUSD", "US500"],
  ["BTCUSD", "XAUUSD"],
  ["EURUSD", "USDJPY"],
  ["US500", "USOIL"],
];

export type BoardTimeframe = "15m" | "1h" | "4h" | "1d";
export const BOARD_TIMEFRAMES: ReadonlyArray<{ id: BoardTimeframe; label: string }> = [
  { id: "15m", label: "M15" },
  { id: "1h", label: "H1" },
  { id: "4h", label: "H4" },
  { id: "1d", label: "D1" },
];
export function isBoardTimeframe(v: unknown): v is BoardTimeframe {
  return v === "15m" || v === "1h" || v === "4h" || v === "1d";
}

export type CandleSource = "exness" | "bridge";

export interface BoardCandleDto {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BoardChartDto {
  symbol: string;
  interval: BoardTimeframe;
  /** Closed candles to draw (the most recent ones). */
  candles: BoardCandleDto[];
  /** The still-forming candle, if the source returned one. */
  forming: BoardCandleDto | null;
  zones: ZoneBoard;
  divergences: DivergenceBoard;
  absorption: AbsorptionBoard;
  setups: SetupBoard;
  fvg: FvgBoard;
  orderBlocks: ObBoard;
  structure: StructureBoard;
  /** Usual daily range for today with projected high and low; built from intraday bars, so null on the D1 chart. */
  expectedRange: ErBoard | null;
  /** Daily volume profile levels; only for intraday charts (M15, H1), null otherwise. */
  volumeProfile: VpBoard | null;
  /** Round-turn cost used by the scorecards, in price units (the latest spread). */
  costUsed: number;
  /** Bars the scorecards were computed on. */
  barsAnalysed: number;
  source: CandleSource;
  asOf: number;
}

export type BoardOverviewRow =
  | { symbol: string; status: "ok"; data: OverviewRow }
  | { symbol: string; status: "unavailable"; message: string };

export interface BoardCorrelationRow {
  a: string;
  b: string;
  status: "ok" | "unavailable";
  data?: CorrelationRow;
  shift?: ShiftStatus;
}

export interface BoardOverviewDto {
  rows: BoardOverviewRow[];
  pairs: BoardCorrelationRow[];
  shiftLevel: number;
  asOf: number;
  source: CandleSource | "mixed" | "none";
}
