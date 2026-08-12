// lib/financial-format.ts
// Sprint D2.7.1 - AT24 Financial Typography & Rendering Foundation. The
// one deterministic numeric-formatting layer for every financial value
// rendered in the Workspace - replaces the ad hoc `toLocaleString`/
// template-literal calls previously hand-rolled per component
// (WorkspaceHeader, MarketRibbon, IntelligencePanel, AuditTraceView each
// had their own slightly different precision rule). Every function here
// is PURE, deterministic, and preserves the source value's real
// precision - it only caps/pads DISPLAY digits, it never invents a
// significant digit the underlying market data didn't provide, and it
// never mutates the real numeric value anywhere upstream (formatting is
// presentation-only, same discipline every D2.6.x intelligence contract
// already follows for its own text output).
//
// Intelligence Score MUST remain "X/100", never a percentage, never a
// probability of profit or trade success - formatScore() below is the
// one place that rule lives, so no future caller can accidentally render
// it as "X%".

const priceFormatterCache = new Map<number, Intl.NumberFormat>();

function priceFormatter(maxDecimals: number): Intl.NumberFormat {
  let formatter = priceFormatterCache.get(maxDecimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: maxDecimals });
    priceFormatterCache.set(maxDecimals, formatter);
  }
  return formatter;
}

export interface FormatPriceOptions {
  /**
   * Upper bound on displayed decimal precision - never pads a REAL value
   * beyond what it actually has, only rounds/caps it. Defaults to 2 (the
   * standard equity/index convention this codebase's own worked examples
   * use: "1,537.90", "24,435.45", "57,261.25"). Pass a higher value (e.g.
   * 5, matching WorkspaceHeader/MarketRibbon's existing FX-pair
   * precision) for instruments whose real quoted precision is finer.
   */
  maxDecimals?: number;
}

/**
 * "1537.9" -> "1,537.90"; "24435.45" -> "24,435.45"; "1.08453" (5 real
 * decimals, maxDecimals:5) -> "1.08453". Padding a trailing zero to the
 * 2-decimal minimum is not fabricated precision - 1537.9 and 1537.90 are
 * the same real number; this is the same universal currency-display
 * convention every financial platform uses. Never returns a placeholder
 * string - callers own the loading/unavailable/stale state (see
 * components/ui/FinancialValue.tsx).
 */
export function formatPrice(value: number, options: FormatPriceOptions = {}): string {
  const maxDecimals = Math.max(options.maxDecimals ?? 2, 2);
  return priceFormatter(maxDecimals).format(value);
}

export interface FormatPercentOptions {
  decimals?: number;
  /** Prefixes a real "+" for a positive value (native JS formatting already prefixes "-" for negatives) - the standard trading convention this codebase's MarketRibbon/IntelligencePanel already followed by hand. Defaults true. */
  signed?: boolean;
}

/** "1.24" -> "+1.24%"; "-0.37" -> "-0.37%"; "0" -> "0.00%" (never a fabricated sign on a genuinely flat value). */
export function formatPercent(value: number, options: FormatPercentOptions = {}): string {
  const decimals = options.decimals ?? 2;
  const signed = options.signed ?? true;
  const magnitude = Math.abs(value).toFixed(decimals);
  const sign = value > 0 && signed ? "+" : value < 0 ? "-" : "";
  return `${sign}${magnitude}%`;
}

/** Whole-unit quantity, thousands-grouped, no fabricated decimals - "1500000" -> "1,500,000". */
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

/** Decimal quantity, thousands-grouped, real precision only - "1500000.5" -> "1,500,000.5". */
export function formatDecimalQuantity(value: number, maxDecimals = 4): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxDecimals }).format(value);
}

/**
 * Large volume figures ONLY - compact notation ("1.5M") is a real,
 * standard financial-platform convention for volume/market-cap-scale
 * numbers, never applied to a price (a price is always shown at full
 * precision - see formatPrice).
 */
export function formatCompactVolume(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

/**
 * Intelligence Score contract (D2.5.5's own formula, unmodified here):
 * ALWAYS "X/100" or "Unavailable" - never "X%", never framed as a
 * probability. This is a presentation-only centralization of the exact
 * rule every intelligence-workspace component already followed by hand
 * since D2.6.10.
 */
export function formatScore(value: number | undefined, max = 100): string {
  return value !== undefined ? `${value}/${max}` : "Unavailable";
}

/** The same X/Y shape as formatScore, for any other real ratio (e.g. "3 of 5 evidence items") - never a percentage. */
export function formatRatio(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`;
}

/**
 * Real elapsed time only - "842" -> "842ms"; "2400" -> "2.4s"; "185000"
 * -> "3m 5s". Never fabricates precision beyond the source millisecond
 * value (e.g. never invents a decimal on a whole-millisecond input).
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
