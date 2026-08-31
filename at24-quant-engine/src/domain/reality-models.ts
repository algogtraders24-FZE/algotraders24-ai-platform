import type { Instrument, OHLCVBar } from "./market-data.js";

/**
 * Behavioral interfaces only (Q0.2.16) — no implementation. These exist so
 * a future backtest engine is written AGAINST these seams from day one,
 * instead of hard-coding "spread = 0" or "fill at close" the way OLD's
 * engines did (see docs/Q0.1_ARCHITECTURE_COMPARISON.md). The static
 * config unions in execution-specification.ts (SpreadModel, SlippageModel,
 * etc.) describe WHAT was assumed; these interfaces are the future plug
 * point for HOW that assumption gets computed.
 */

export interface FeeContext {
  readonly quantity: number;
  readonly notional: number;
}
export interface FeeModel {
  computeFee(context: FeeContext): number;
}

export interface SpreadContext {
  readonly instrument: Instrument;
  readonly asOf: number;
}
export interface SpreadModel {
  computeSpread(context: SpreadContext): number;
}

export interface SlippageContext {
  readonly requestedPrice: number;
  readonly quantity: number;
}
export interface SlippageModel {
  computeSlippage(context: SlippageContext): number;
}

export interface FillContext {
  readonly requestedPrice: number;
  readonly bar: OHLCVBar;
}
export interface FillResult {
  readonly filled: boolean;
  readonly price?: number;
}
export interface FillModel {
  resolveFill(context: FillContext): FillResult;
}

export interface MarginContext {
  readonly notional: number;
  readonly leverage: number;
}
export interface MarginModel {
  computeRequiredMargin(context: MarginContext): number;
}

export interface LatencyContext {
  readonly asOf: number;
}
export interface LatencyModel {
  computeDelayMs(context: LatencyContext): number;
}
