// lib/chart-engine/canvas-colors.ts
// Sprint D2.7.2 - resolves the chart's colors from AT24's EXISTING design
// tokens (app/globals.css) rather than a chart-specific palette, so the
// native chart genuinely matches the platform's black/gold identity
// instead of approximating it. Client-only (reads getComputedStyle);
// fallback values below are the exact hex values those tokens currently
// resolve to (app/globals.css `:root`), kept only as an SSR/test safety
// net - never a second, drifting color source in practice.
export interface ChartColors {
  background: string;
  grid: string;
  border: string;
  textPrimary: string;
  textTertiary: string;
  bullish: string;
  bearish: string;
  gold: string;
}

const FALLBACK_COLORS: ChartColors = {
  background: "#131826", // --ink-2
  grid: "#232b3d", // --border
  border: "#232b3d", // --border
  textPrimary: "#ffffff", // --text
  textTertiary: "#7b889b", // --text-3
  bullish: "#3fb27f", // --signal-up
  bearish: "#d1594a", // --signal-down
  gold: "#d4af37", // --gold
};

let cached: ChartColors | null = null;

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function resolveChartColors(): ChartColors {
  if (cached) return cached;
  if (typeof document === "undefined") return FALLBACK_COLORS;
  const styles = getComputedStyle(document.documentElement);
  cached = {
    background: readVar(styles, "--ink-2", FALLBACK_COLORS.background),
    grid: readVar(styles, "--border", FALLBACK_COLORS.grid),
    border: readVar(styles, "--border", FALLBACK_COLORS.border),
    textPrimary: readVar(styles, "--text", FALLBACK_COLORS.textPrimary),
    textTertiary: readVar(styles, "--text-3", FALLBACK_COLORS.textTertiary),
    bullish: readVar(styles, "--signal-up", FALLBACK_COLORS.bullish),
    bearish: readVar(styles, "--signal-down", FALLBACK_COLORS.bearish),
    gold: readVar(styles, "--gold", FALLBACK_COLORS.gold),
  };
  return cached;
}

/** Test/dev-only reset so a test can simulate a fresh module load. */
export function resetColorCacheForTests(): void {
  cached = null;
}
