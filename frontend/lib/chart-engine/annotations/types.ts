// lib/chart-engine/annotations/types.ts
// Professional Mode (2026-11-19) - the market-structure annotations drawn on the native chart:
// zones (FVG, order blocks, breakers, premium / discount / OTE), support / resistance levels with touch counts,
// structure breaks (BOS / CHoCH), liquidity sweeps, chart patterns and session markers.
// Every annotation is anchored in REAL time / price space (never pixels), exactly like DrawingObject, and is
// computed by pure functions from the candle series (compute.ts). These are DESCRIPTIVE structure maps: they say
// where price did something, not where it will go. Our own tests found no reliable directional edge in these
// concepts, so no annotation carries a prediction.

export type AnnotationGroup = "zones" | "levels" | "structure" | "pdOte" | "sessions" | "patterns";

export const ANNOTATION_GROUPS: readonly AnnotationGroup[] = ["zones", "levels", "structure", "pdOte", "sessions", "patterns"];

export const ANNOTATION_GROUP_LABELS: Record<AnnotationGroup, string> = {
  zones: "Zones (OB / FVG)",
  levels: "S/R levels",
  structure: "Structure (BOS / CHoCH / sweep)",
  pdOte: "Premium / discount / OTE",
  sessions: "Sessions (London / New York)",
  patterns: "Patterns",
};

export type ZoneKind = "fvg" | "orderBlock" | "breaker" | "premium" | "discount" | "ote";
export type Bias = "bullish" | "bearish";

interface Base {
  id: string;
  group: AnnotationGroup;
  /** Short label drawn on the chart ("Supply OB", "CHoCH", "Double Top", ...). */
  label: string;
}

export interface ZoneAnnotation extends Base {
  type: "zone";
  kind: ZoneKind;
  bias: Bias | null;
  /** Epoch ms of the candle where the zone starts (its left edge). */
  startTime: number;
  /** Epoch ms where the zone ends; null = extends to the right edge (still active). */
  endTime: number | null;
  low: number;
  high: number;
}

export interface LevelAnnotation extends Base {
  type: "level";
  price: number;
  touches: number;
  startTime: number;
}

export interface StructureAnnotation extends Base {
  type: "structure";
  kind: "BOS" | "CHoCH";
  bias: Bias;
  /** The swing point that was broken (left end of the line) and the candle that broke it (right end). */
  fromTime: number;
  toTime: number;
  price: number;
}

export interface MarkerAnnotation extends Base {
  type: "marker";
  kind: "sweep";
  bias: Bias;
  time: number;
  price: number;
}

export interface PatternAnnotation extends Base {
  type: "pattern";
  kind: "doubleTop" | "doubleBottom";
  /** The two peaks / troughs and the neckline. */
  t1: number;
  t2: number;
  price1: number;
  price2: number;
  neckline: number;
}

export interface SessionAnnotation extends Base {
  type: "session";
  session: "LDN" | "NY";
  time: number;
}

export type ChartAnnotation = ZoneAnnotation | LevelAnnotation | StructureAnnotation | MarkerAnnotation | PatternAnnotation | SessionAnnotation;

export interface AnnotationCounts {
  total: number;
  lines: number;
  zones: number;
  markers: number;
  levels: number;
  patterns: number;
  sessions: number;
}

export interface AnnotationResult {
  annotations: ChartAnnotation[];
  counts: AnnotationCounts;
  /** Swing size parameter and ATR used - shown in the panel so the numbers can be re-checked. */
  params: { swingBars: number; atr: number };
}

/** Which annotation groups are visible. Everything is off in "clean chart" mode. */
export type AnnotationLayers = Record<AnnotationGroup, boolean>;

export const ALL_LAYERS_ON: AnnotationLayers = { zones: true, levels: true, structure: true, pdOte: true, sessions: true, patterns: true };
export const ALL_LAYERS_OFF: AnnotationLayers = { zones: false, levels: false, structure: false, pdOte: false, sessions: false, patterns: false };
