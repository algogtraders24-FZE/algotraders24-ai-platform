import type { StrategyIR } from "./strategy-ir.js";
import type { StrategyTranslationReport } from "./translation-report.js";

/**
 * Q0.7.41-45/51 — FUTURE INTERFACE DEFINITIONS ONLY. No implementation
 * exists anywhere in this package (Q0.7's explicit "do not implement a
 * full parser" boundary) — these signatures exist so the IR is never a
 * one-way translation target (Q0.7.51's explicit rationale: without a
 * defined Generator interface, nothing would prevent the IR from quietly
 * becoming "the thing MQL/Pine/etc. compile INTO" with no path back out).
 * A future sprint implementing a real parser/generator implements these
 * interfaces directly, never a parallel shape.
 */
export interface SourceParser {
  readonly sourcePlatform: string;
  parse(sourceCode: string): { readonly ir: StrategyIR; readonly report: StrategyTranslationReport };
}

// Q0.7.41: fixtures target this shape; no MQL4-specific method exists yet.
export type MQL4Parser = SourceParser;
// Q0.7.42
export type MQL5Parser = SourceParser;
// Q0.7.43
export type PineParser = SourceParser;
// Q0.7.44
export type NinjaScriptParser = SourceParser;
// Q0.7.45
export type CTraderParser = SourceParser;

/** Q0.7.51 — the reverse direction. No implementation exists; the interface exists so code generation is a defined future capability, not an afterthought. */
export interface SourceGenerator {
  readonly targetPlatform: string;
  generate(ir: StrategyIR): { readonly sourceCode: string; readonly report: StrategyTranslationReport };
}

export type MQL4Generator = SourceGenerator;
export type MQL5Generator = SourceGenerator;
export type PineGenerator = SourceGenerator;
export type NinjaGenerator = SourceGenerator;
export type CTraderGenerator = SourceGenerator;
