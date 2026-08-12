// types/chart-typography-contract.ts
// Sprint D2.7.1 - AT24 Financial Typography & Rendering Foundation.
// FOUNDATION ONLY - defines the typography contract a future native AT24
// chart engine will consume once it exists. No chart rendering is built
// here (explicitly out of scope - see the sprint's own STOP condition:
// do not build the native chart engine yet). Every role maps to the SAME
// financial typography tokens (components/ui/financial-typography.ts)
// and the SAME formatters (lib/financial-format.ts) already used across
// the Workspace today, so a future chart's axis/tooltip/crosshair numbers
// will look identical to every other number on the platform - never a
// second, chart-specific typography system invented later under time
// pressure.
import { FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY, FIN_LABEL } from "@/components/ui/financial-typography";

export type ChartTypographyRole =
  | "axis-label"
  | "price-scale"
  | "time-scale"
  | "ohlc-value"
  | "crosshair-value"
  | "tooltip-value"
  | "indicator-label"
  | "volume-label"
  | "drawing-tool-label";

/** Names a real formatter from lib/financial-format.ts - never a chart-specific duplicate formatting rule. */
export type ChartTypographyFormatter = "price" | "percent" | "quantity" | "compact-volume" | "timestamp" | "score";

export interface ChartTypographySpec {
  role: ChartTypographyRole;
  /** One of the existing FIN_* class constants - never a new, chart-only style. */
  className: string;
  formatter: ChartTypographyFormatter;
}

export const CHART_TYPOGRAPHY_CONTRACT: Record<ChartTypographyRole, ChartTypographySpec> = {
  "axis-label": { role: "axis-label", className: FIN_TERTIARY, formatter: "price" },
  "price-scale": { role: "price-scale", className: FIN_PRIMARY, formatter: "price" },
  "time-scale": { role: "time-scale", className: FIN_TERTIARY, formatter: "timestamp" },
  "ohlc-value": { role: "ohlc-value", className: FIN_SECONDARY, formatter: "price" },
  "crosshair-value": { role: "crosshair-value", className: FIN_PRIMARY, formatter: "price" },
  "tooltip-value": { role: "tooltip-value", className: FIN_SECONDARY, formatter: "price" },
  "indicator-label": { role: "indicator-label", className: FIN_LABEL, formatter: "quantity" },
  "volume-label": { role: "volume-label", className: FIN_TERTIARY, formatter: "compact-volume" },
  "drawing-tool-label": { role: "drawing-tool-label", className: FIN_LABEL, formatter: "price" },
};
