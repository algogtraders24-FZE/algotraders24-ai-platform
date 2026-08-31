import type { Instrument, Timeframe } from "./market-data.js";

/**
 * Type-only contracts for market-structure concepts (Q0.2.17). No
 * detection algorithm is implemented here — see
 * docs/Q0.2_MARKET_STRUCTURE_CONTRACTS.md for precise, non-vague
 * definitions of each concept and its detection-state/repainting
 * semantics.
 */

/** "final": can never change once detected. "provisional-may-repaint": could still be revised/withdrawn by later bars. "provisional-confirmed-on-close": becomes final once its defining bar closes. */
export type RepaintingPolicy = "final" | "provisional-may-repaint" | "provisional-confirmed-on-close";

export type DetectionState = "forming" | "confirmed" | "invalidated";

export interface MarketStructureEventBase {
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly detectedAt: number;
  readonly detectionState: DetectionState;
  readonly repaintingPolicy: RepaintingPolicy;
}

export type SwingDirection = "high" | "low";
export interface SwingPoint extends MarketStructureEventBase {
  readonly kind: "swing-point";
  readonly direction: SwingDirection;
  readonly price: number;
  readonly barTimestamp: number;
}

export type StructureBreakDirection = "bullish" | "bearish";

export interface BreakOfStructure extends MarketStructureEventBase {
  readonly kind: "bos";
  readonly direction: StructureBreakDirection;
  readonly brokenLevel: number;
  readonly referenceSwing: SwingPoint;
}

export interface ChangeOfCharacter extends MarketStructureEventBase {
  readonly kind: "choch";
  readonly direction: StructureBreakDirection;
  readonly brokenLevel: number;
  readonly referenceSwing: SwingPoint;
}

export interface MarketStructureShift extends MarketStructureEventBase {
  readonly kind: "mss";
  readonly direction: StructureBreakDirection;
  readonly brokenLevel: number;
  readonly referenceSwing: SwingPoint;
  readonly confidence?: number;
}

export type LiquidityLevelKind = "equal-highs" | "equal-lows" | "session-high" | "session-low" | "swing-level";
export interface LiquidityLevel extends MarketStructureEventBase {
  readonly kind: "liquidity-level";
  readonly levelKind: LiquidityLevelKind;
  readonly price: number;
}

export interface LiquiditySweep extends MarketStructureEventBase {
  readonly kind: "liquidity-sweep";
  readonly sweptLevel: LiquidityLevel;
  readonly sweepPrice: number;
  readonly reversed: boolean;
}

export type FvgDirection = "bullish" | "bearish";
export interface FairValueGap extends MarketStructureEventBase {
  readonly kind: "fvg";
  readonly direction: FvgDirection;
  readonly gapHigh: number;
  readonly gapLow: number;
  readonly filledFraction?: number;
}

export type OrderBlockDirection = "bullish" | "bearish";
export interface OrderBlock extends MarketStructureEventBase {
  readonly kind: "order-block";
  readonly direction: OrderBlockDirection;
  readonly high: number;
  readonly low: number;
  readonly mitigated: boolean;
}

export interface Displacement extends MarketStructureEventBase {
  readonly kind: "displacement";
  readonly direction: StructureBreakDirection;
  readonly magnitude: number;
  readonly barCount: number;
}

export type MarketStructureEvent =
  | SwingPoint
  | BreakOfStructure
  | ChangeOfCharacter
  | MarketStructureShift
  | LiquidityLevel
  | LiquiditySweep
  | FairValueGap
  | OrderBlock
  | Displacement;
