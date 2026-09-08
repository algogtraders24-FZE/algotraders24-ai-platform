// data/quant-positioning.ts
// Sprint IA2 - single source of truth for the Quant Lite vs Quant Pro
// feature lists, extracted from what was previously only inline in
// app/quant-lite/upgrade/page.tsx (Sprint Q0.8) so the new /quant umbrella
// landing page can present the exact same honest positioning without a
// second, potentially-drifting copy. LITE_FEATURES mirrors the real
// product ceiling (SUPPORTED_INDICATOR_TYPES / SUPPORTED_CODEGEN_LANGUAGES
// etc, per Q1.6 Part 3's own note) - nothing here is marketing copy.
// PRO_FEATURES is what's planned, not built - both consumers must keep
// showing it as "not yet available", never as a live product.
export const QUANT_LITE_FEATURES = [
  "Strategy creation with 10 supported indicators",
  "Deterministic backtesting on the canonical execution engine",
  "Real, time-varying spread modeling",
  "Strategy library (research/discovery evidence)",
  "Equity curve and trade-level detail",
] as const;

export const QUANT_PRO_FEATURES = [
  "Advanced execution modeling",
  "Tick-level / higher-fidelity backtest replay",
  "Robustness and walk-forward analysis",
  "Advanced validation tooling",
  "Institutional-style research capabilities",
] as const;
