// types/technical-analysis.ts
export interface TechnicalIndicators {
  ema: number;
  rsi: number;
  macd: number;
  atr: number;
  trendStrength: number; // 0–100
}

export interface SupportResistance {
  support: number[];
  resistance: number[];
  breakoutZones: number[];
}

export interface LiquidityZones {
  buySide: number[];
  sellSide: number[];
  equalHighs: number[];
  equalLows: number[];
}