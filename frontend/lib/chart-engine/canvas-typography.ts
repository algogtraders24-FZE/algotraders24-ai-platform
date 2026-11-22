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

const FALLBACK_SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
let cachedSans: string | null = null;

export function resolveSansFontFamily(): string {
  if (cachedSans) return cachedSans;
  if (typeof document === "undefined") return FALLBACK_SANS;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  cachedSans = value.length > 0 ? value : FALLBACK_SANS;
  return cachedSans;
}

/** Which family every chart canvas text uses for the current frame: "mono" (default, MT5 style) or "sans" (the Pro Chart, like the reference chart). Set once per frame by renderChart. */
let fontKind: "mono" | "sans" = "mono";
export function setCanvasFontKind(kind: "mono" | "sans"): void {
  fontKind = kind;
}

/** Price / time axis text: the mono stack as before, or (Pro Chart) a larger medium-weight sans like the reference chart. */
export function canvasAxisFont(sizePx: number): string {
  if (fontKind === "sans") return `500 ${sizePx + 2}px ${resolveSansFontFamily()}`;
  return `${sizePx}px ${resolveMonoFontFamily()}`;
}

/** Canvas 2D `ctx.font` string at a given pixel size, using the resolved AT24 mono font stack (or the sans stack when the frame was set to "sans"). */
export function canvasMonoFont(sizePx: number, weight: number | string = 400): string {
  if (fontKind === "sans") return `${weight} ${sizePx}px ${resolveSansFontFamily()}`;
  return `${weight === 400 ? "" : weight + " "}${sizePx}px ${resolveMonoFontFamily()}`;
}

/** Test/dev-only reset so a test can simulate a fresh module load. */
export function resetFontCacheForTests(): void {
  cachedFamily = null;
  cachedSans = null;
  fontKind = "mono";
}
