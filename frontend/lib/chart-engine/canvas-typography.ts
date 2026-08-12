// lib/chart-engine/canvas-typography.ts
// Sprint D2.7.2 - bridges D2.7.1's typography foundation (Geist Mono via
// the --font-mono CSS variable set in app/layout.tsx) into Canvas 2D text
// rendering, where CSS classes/variables don't apply directly - exactly the
// gap D2.7.1's own spec (§9) flagged as future work for this sprint. The
// chart's price/time/OHLC/crosshair text uses the SAME font every other
// numeric value on the platform uses, never a chart-only font choice.
// Client-only (reads getComputedStyle); returns a safe monospace fallback
// during SSR/tests where `document` doesn't exist, so this module never
// throws outside a browser.
const FALLBACK_FONT_FAMILY = "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

let cachedFamily: string | null = null;

export function resolveMonoFontFamily(): string {
  if (cachedFamily) return cachedFamily;
  if (typeof document === "undefined") return FALLBACK_FONT_FAMILY;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  cachedFamily = value.length > 0 ? value : FALLBACK_FONT_FAMILY;
  return cachedFamily;
}

/** Canvas 2D `ctx.font` string at a given pixel size, using the resolved AT24 mono font stack. */
export function canvasMonoFont(sizePx: number): string {
  return `${sizePx}px ${resolveMonoFontFamily()}`;
}

/** Test/dev-only reset so a test can simulate a fresh module load. */
export function resetFontCacheForTests(): void {
  cachedFamily = null;
}
