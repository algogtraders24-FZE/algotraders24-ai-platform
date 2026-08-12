// lib/chart-engine/types.ts
// Sprint D2.7.2 - AT24 Native Chart Engine Foundation. Internal, engine-only
// geometry types - never imported by anything outside lib/chart-engine or
// components/chart-engine (the public data contract is types/chart-data.ts).
// Kept separate from that file because these describe SCREEN geometry
// (pixels, viewport bounds), not market data.

/** The visible window: a horizontal time range and the vertical price range that fits it. Both bounds are real values (a real timestamp, a real price) - never a pixel value. */
export interface Viewport {
  minTime: number;
  maxTime: number;
  minPrice: number;
  maxPrice: number;
}

export interface ChartDimensions {
  /** CSS pixels - the renderer/coordinate-system operate in CSS pixel space; devicePixelRatio scaling is applied once by the caller via ctx.scale, never re-derived per draw call. */
  width: number;
  height: number;
  /** Reserved right-hand gutter width (px) for price axis labels - subtracted from `width` to get the real candle-plot width. */
  priceAxisWidth: number;
  /** Reserved bottom gutter height (px) for time axis labels - subtracted from `height` to get the real candle-plot height. */
  timeAxisHeight: number;
}

export interface CrosshairState {
  /** Index into the candle array the crosshair is snapped to. */
  index: number;
  /** Real pixel position within the plot area (not the full canvas). */
  x: number;
  y: number;
}
