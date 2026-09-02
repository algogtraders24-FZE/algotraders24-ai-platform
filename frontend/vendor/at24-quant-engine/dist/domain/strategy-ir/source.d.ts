/**
 * Q0.7.2 — explicit source provenance. NEVER inferred from strategy
 * behavior (e.g. "this looks like it uses netting, so it's probably MT5")
 * — a translator/compiler must set this directly from where the strategy
 * actually came from.
 */
export type SourcePlatform = "MT4_MQL4" | "MT5_MQL5" | "TRADINGVIEW_PINE" | "NINJATRADER_NINJASCRIPT" | "CTRADER_CBOT" | "AT24_NATIVE" | "AI_GENERATED" | "UNKNOWN";
/**
 * Q0.7.3 — per Q0.4_STRATEGY_IR.md's Source Fidelity reservation, now
 * finalized with Q0.7's exact naming (EXACT/SEMANTIC_EQUIVALENT/
 * APPROXIMATED/UNSUPPORTED — the same four grades Q0.4 called EXACT/
 * SEMANTICALLY_EQUIVALENT/APPROXIMATE/UNSUPPORTED). Unsupported semantics
 * are NEVER silently translated (Q0.7.3) — they must surface as an
 * UnsupportedSemantic record (unsupported.ts), never a best-effort guess
 * mislabeled as SEMANTIC_EQUIVALENT.
 */
export type SemanticFidelity = "EXACT" | "SEMANTIC_EQUIVALENT" | "APPROXIMATED" | "UNSUPPORTED";
/** Q0.7.33 — traceable back to the original source text, where a parser can supply it. */
export interface SourceLocation {
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
    readonly sourceHash: string;
}
