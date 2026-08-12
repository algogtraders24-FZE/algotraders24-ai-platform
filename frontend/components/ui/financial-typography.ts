// components/ui/financial-typography.ts
// Sprint D2.7.1 - AT24 Financial Typography & Rendering Foundation. The
// canonical financial-number typography contract: a small set of
// composed class-string constants built ENTIRELY from tokens that
// already exist (app/globals.css's --text/--text-2/--text-3/--signal-up/
// --signal-down and the Geist Mono font already loaded in app/layout.tsx)
// - no new colors, no new font, no second design system. Every workspace
// component that renders a financial number should compose one of these
// instead of hand-chaining "font-mono text-sm text-text" ad hoc (the
// exact drift this sprint's own audit found across MarketRibbon/
// WorkspaceHeader/IntelligencePanel/AuditTraceView, each with a slightly
// different weight/size/spacing choice for what is conceptually the same
// value tier).
//
// Contrast hierarchy (Phase 4): PRIMARY = the number a trader looks at
// first (price, main symbol); SECONDARY = the next-most-important number
// (percentage change, OHLC, key metrics); TERTIARY = provenance/metadata
// (provider, timestamp, freshness, latency); LABEL = the small uppercase
// caption above a value (already StatField's own convention, reused
// verbatim here rather than inventing a second one). Never solved by
// making everything brighter/bolder - the SAME three text colors this
// project already uses everywhere else, just applied consistently to
// numbers specifically.
//
// `fin-num` (defined once in app/globals.css) is the numeric-rendering
// contract itself: font-variant-numeric: tabular-nums plus the
// OpenType "tnum" feature. Redundant with Geist Mono's own inherent
// fixed advance widths today (a true monospace font is already
// tabular) - kept explicit anyway because (a) it is the literal,
// harmless instruction Phase 2 of this sprint asks for, and (b) it is
// the correct preparation for the future native chart engine, which
// will render numbers in axis/tooltip contexts that are not guaranteed
// to be monospace - see types/chart-typography-contract.ts.
export const FIN_PRIMARY = "fin-num font-mono text-text";
export const FIN_SECONDARY = "fin-num font-mono text-text-2";
export const FIN_TERTIARY = "fin-num font-mono text-text-3";
/** Explanatory/prose UI text near a financial value - deliberately NOT monospace/tabular (it is not a number). */
export const FIN_MUTED = "text-text-3";
/** The small uppercase caption above a value - identical to StatField's own existing label rule (components/workspace/StatField.tsx), reused verbatim so a value rendered via FinancialValue and one rendered via StatField never drift apart. */
export const FIN_LABEL = "text-[10px] font-medium uppercase tracking-wider text-text-3";

export type FinancialDirection = "up" | "down" | "neutral";

/** Maps a direction to the SAME --signal-up/--signal-down tokens every existing badge/ribbon cell already uses - never a new color. */
export function financialDirectionClass(direction: FinancialDirection): string {
  if (direction === "up") return "text-signal-up";
  if (direction === "down") return "text-signal-down";
  return "text-text-2";
}

/** A change of exactly 0 (or unknown) is honestly neutral - never guessed up/down. */
export function directionFromChange(change: number | undefined): FinancialDirection {
  if (change === undefined || change === 0) return "neutral";
  return change > 0 ? "up" : "down";
}
