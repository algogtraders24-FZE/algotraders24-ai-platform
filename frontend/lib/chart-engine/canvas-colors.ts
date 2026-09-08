// lib/chart-engine/canvas-colors.ts
// Sprint D2.7.2 - resolves the chart's colors from AT24's EXISTING design
// tokens (app/globals.css) rather than a chart-specific palette, so the
// native chart genuinely matches the platform's black/gold identity
// instead of approximating it. Client-only (reads getComputedStyle);
// fallback values below are the exact hex values those tokens currently
// resolve to (app/globals.css `:root`), kept only as an SSR/test safety
// net - never a second, drifting color source in practice.
//
// MT5-style theme (this session) - the user asked the Native Chart to
// visually replicate their live MetaTrader 5 terminal (screenshot
// reference: pure black canvas, hollow white/black-outlined candles, a
// near-invisible grid, a highlighted dotted current-price line). This is
// DELIBERATELY a hardcoded, chart-only palette rather than a change to
// AT24's shared --ink-2/--border/--signal-up/--signal-down tokens: those
// tokens are reused across the rest of the platform (per D2.7.2's own
// header comment above), and MT5's exact black/white/hollow-candle look
// has no honest mapping onto AT24's green/red brand signal colors without
// changing what those colors mean everywhere else. Selected via
// resolveChartColors({ theme: "mt5" }) - "at24" (the original, unchanged
// token-driven palette) remains the default so nothing else regresses.
export interface ChartColors {
  background: string;
  grid: string;
  border: string;
  textPrimary: string;
  textTertiary: string;
  bullish: string;
  bearish: string;
  gold: string;
  /** MT5-style only: the outline stroke on a hollow bearish candle body, distinct from its fill so a black body stays visible on a black background. Falls back to bearish for the "at24" theme (no separate outline concept there). */
  bearishOutline: string;
  /** MT5-style only: the axis/current-price highlight color, distinct from `gold` so the platform's brand accent is never silently repurposed by this theme. Falls back to gold for the "at24" theme. */
  accent: string;
  /** MT5-style only: a single uniform volume-bar color (matching the user's live terminal reference, which shows plain green bars, not a bullish/bearish two-tone). Undefined for the "at24" theme, which keeps its existing bullish/bearish two-tone volume bars unchanged - see sub-panel-renderer.ts's drawVolumePanel(). */
  volume?: string;
  /**
   * Paper Trading (this session) - the Buy/Ask and Sell/Bid trade-line
   * colors drawn when a live quote + the active paper-trading pane are
   * present (renderer.ts's drawTradeLines()). Deliberately the SAME
   * platform-wide --signal-up/--signal-down semantic every chart theme's
   * `bullish`/`bearish` fields already read for "at24" - but defined as
   * its own field rather than reused directly, because `bullish`/`bearish`
   * are candle-BODY colors that intentionally diverge from that semantic
   * in the mt5 theme (bearish=black, a hollow-candle outline choice, not a
   * "down" signal color) and mt5-green (bearish=white). A trade-direction
   * line needs a universal, always-green-for-buy/red-for-sell meaning,
   * consistent with PaperTradingPanel.tsx's own P&L text/BUY-SELL badge
   * colors (text-signal-up/text-signal-down) in every theme - so it is
   * never confused with, or accidentally flipped by, this theme's own
   * candle-body convention.
   */
  buyLine: string;
  sellLine: string;
}

export type ChartTheme = "at24" | "mt5" | "mt5-green" | "light";

/** Sprint D2.7.11 Phase 5c - human-readable labels for the Properties dialog's Colors-tab scheme picker, in the same order OPTIONS lists them. */
export const CHART_THEME_LABELS: Record<ChartTheme, string> = { at24: "AT24", mt5: "Black", "mt5-green": "Green on Black", light: "Light" };

const FALLBACK_COLORS: ChartColors = {
  background: "#131826", // --ink-2
  grid: "#232b3d", // --border
  border: "#232b3d", // --border
  textPrimary: "#ffffff", // --text
  textTertiary: "#7b889b", // --text-3
  bullish: "#3fb27f", // --signal-up
  bearish: "#d1594a", // --signal-down
  gold: "#d4af37", // --gold
  bearishOutline: "#d1594a",
  accent: "#d4af37",
  buyLine: "#3fb27f",
  sellLine: "#d1594a",
};

// MT5's real "Black" default scheme, matched against the user's own live
// terminal screenshot: pure black canvas, white hollow-up / black-with-
// white-outline-down candles, a near-invisible dark-gray grid, white axis
// text, and a muted teal current-price highlight (MT5's own default
// current-price-line color, distinct from any candle color so it's never
// confused with a bullish/bearish signal).
const MT5_COLORS: ChartColors = {
  background: "#000000",
  grid: "#141414",
  border: "#2a2a2a",
  textPrimary: "#e8e8e8",
  textTertiary: "#b0b0b0",
  bullish: "#ffffff",
  bearish: "#000000",
  bearishOutline: "#e8e8e8",
  gold: "#4fc3c8",
  accent: "#4fc3c8",
  volume: "#2e7d32",
  buyLine: "#3fb27f",
  sellLine: "#d1594a",
};

// Sprint D2.7.11 Phase 5c - MT5's real "Green on Black" built-in scheme
// (Properties dialog, Colors tab - verified against the user's own live
// screenshot of that exact dropdown/color list): Background Black,
// Foreground White, Grid/Bid-price-line LightSlateGray, Bar
// up/Line-chart/Volumes in the green family (Lime/LimeGreen), Bear candle
// White (so both directions stay visible against the black background
// without needing a separate outline color, the same "outline == fill"
// simplification the "at24" theme already uses), Last-price-line the
// screenshot's own exact RGB(0,192,0). This is a genuinely distinct,
// MT5-grounded second scheme - never an invented palette.
const MT5_GREEN_COLORS: ChartColors = {
  background: "#000000",
  grid: "#778899", // LightSlateGray
  border: "#778899",
  textPrimary: "#ffffff",
  textTertiary: "#a9b4c0",
  bullish: "#00ff00", // Lime
  bearish: "#ffffff",
  bearishOutline: "#ffffff",
  gold: "#00c000", // Last price line, RGB(0,192,0)
  accent: "#00c000",
  volume: "#32cd32", // LimeGreen
  buyLine: "#3fb27f",
  sellLine: "#d1594a",
};

// Sprint D2.9.1 - a genuine white/light chart-canvas scheme, distinct from
// the platform's own app-wide theme (app/globals.css is deliberately
// "Dark-committed" - the dashboard chrome around the chart never goes
// light). This mirrors how mt5/mt5-green already treat chart background as
// its own trader preference, independent of the surrounding app UI. This is
// AT24's own light palette, not a claimed MT5 default - MT5's own real
// default scheme is unverified and not represented here, unlike mt5/mt5-
// green above which were matched against the user's live screenshots.
// `accent` deliberately isn't `gold` (#d4af37 has ~1.6:1 contrast against
// white, failing WCAG AA) - a saturated blue reads clearly as a distinct
// "current price" marker against a white background instead.
const LIGHT_COLORS: ChartColors = {
  background: "#ffffff",
  grid: "#e5e7eb",
  border: "#d1d5db",
  textPrimary: "#111827",
  textTertiary: "#6b7280",
  bullish: "#16a34a",
  bearish: "#dc2626",
  bearishOutline: "#dc2626",
  gold: "#2563eb",
  accent: "#2563eb",
  buyLine: "#3fb27f",
  sellLine: "#d1594a",
};

let cached: Record<ChartTheme, ChartColors | null> = { at24: null, mt5: null, "mt5-green": null, light: null };

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function resolveChartColors(theme: ChartTheme = "at24"): ChartColors {
  if (theme === "mt5") return MT5_COLORS;
  if (theme === "mt5-green") return MT5_GREEN_COLORS;
  if (theme === "light") return LIGHT_COLORS;

  if (cached.at24) return cached.at24;
  if (typeof document === "undefined") return FALLBACK_COLORS;
  const styles = getComputedStyle(document.documentElement);
  const resolved: ChartColors = {
    background: readVar(styles, "--ink-2", FALLBACK_COLORS.background),
    grid: readVar(styles, "--border", FALLBACK_COLORS.grid),
    border: readVar(styles, "--border", FALLBACK_COLORS.border),
    textPrimary: readVar(styles, "--text", FALLBACK_COLORS.textPrimary),
    textTertiary: readVar(styles, "--text-3", FALLBACK_COLORS.textTertiary),
    bullish: readVar(styles, "--signal-up", FALLBACK_COLORS.bullish),
    bearish: readVar(styles, "--signal-down", FALLBACK_COLORS.bearish),
    gold: readVar(styles, "--gold", FALLBACK_COLORS.gold),
    bearishOutline: readVar(styles, "--signal-down", FALLBACK_COLORS.bearish),
    accent: readVar(styles, "--gold", FALLBACK_COLORS.gold),
    buyLine: readVar(styles, "--signal-up", FALLBACK_COLORS.buyLine),
    sellLine: readVar(styles, "--signal-down", FALLBACK_COLORS.sellLine),
  };
  cached.at24 = resolved;
  return resolved;
}

/** Test/dev-only reset so a test can simulate a fresh module load. */
export function resetColorCacheForTests(): void {
  cached = { at24: null, mt5: null, "mt5-green": null, light: null };
  indicatorColorCache.clear();
}

// Sprint D2.7.11 - a real, previously-undetected bug this session's own
// pixel-sampling live-verification found (not something Bill Williams'
// tools introduced - it affects every indicator whose IndicatorLine.color
// is a literal "var(--x)" string: EMA/SMA/RSI, Ichimoku's Kijun/Chikou,
// MACD's signal line, and now Alligator/Fractals too). Canvas 2D's
// fillStyle/strokeStyle setters do NOT support CSS var() syntax - per
// spec, assigning an unparseable color silently leaves the PREVIOUS
// strokeStyle/fillStyle unchanged, so every one of those lines has always
// drawn in whatever color the last successful assignment happened to be
// (a candle body color, the grid color, etc.) rather than its own real,
// intended token color. Confirmed directly: `ctx.strokeStyle =
// "var(--steel)"` on a real canvas leaves strokeStyle unchanged even
// though `getComputedStyle(document.documentElement).getPropertyValue
// ("--steel")` resolves correctly - proving the var() syntax itself,
// not the underlying CSS variable, is what canvas rejects.
//
// The fix: resolve "var(--x)" to its real computed hex/rgb value ONCE,
// at the actual draw boundary (drawLine/drawDots below) - never at the
// token-reference layer (compute.ts/panel-registry.ts keep writing
// "var(--gold)" etc, which stays the correct semantic reference; only
// the thing that hands a color to ctx.strokeStyle/fillStyle needs a real
// resolved value). Cached per CSS variable name, invalidated only by
// resetColorCacheForTests() (mirrors resolveChartColors()'s own "at24"
// caching precedent) - never re-read on every single draw call.
const indicatorColorCache = new Map<string, string>();
const CSS_VAR_PATTERN = /^var\((--[\w-]+)\)$/;

export function resolveIndicatorColor(color: string): string {
  const match = color.match(CSS_VAR_PATTERN);
  if (!match) return color; // already a real color (e.g. a raw hex) - never touched
  const varName = match[1];
  const cachedValue = indicatorColorCache.get(varName);
  if (cachedValue) return cachedValue;
  if (typeof document === "undefined") return color; // SSR safety - never crash, just fall through unresolved
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (resolved.length === 0) return color; // the variable genuinely doesn't exist - never fabricate a color
  indicatorColorCache.set(varName, resolved);
  return resolved;
}
