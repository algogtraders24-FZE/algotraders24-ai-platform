// services/algo-test/nl-strategy-compiler-summary.ts
// P4 - the ONE place a CompileNaturalLanguageStrategyResult (which
// carries real engine objects and a function - StrategyIR,
// buildIndicatorSeries - neither meant to cross an API boundary as-is)
// becomes a plain, JSON-safe review payload. `compiledSpec` is already
// pure data (no function fields) once it exists, so this is a pick, not
// a rewrite - a future UI renders `strategy` however it wants, this
// layer does not pre-format it into prose.
import type { CompileNaturalLanguageStrategyResult } from "./nl-strategy-compiler.service";

export interface CompiledStrategySummary {
  readonly reachedStage: string;
  readonly stages: readonly { readonly stage: string; readonly outcome: string; readonly detail?: string }[];
  /** Present only once the compilation reached EXECUTION_VALID - there is nothing safe to show as a reviewable strategy otherwise, only the failure reason already in `stages`. The compiled StrategySpec's own entryRules/exitRules/risk/instruments/timeframes fields, unmodified. */
  readonly strategy?: CompileNaturalLanguageStrategyResult["compiledSpec"];
}

export function summarizeCompiledStrategy(result: CompileNaturalLanguageStrategyResult): CompiledStrategySummary {
  const stages = result.stages.map((s) => ({ stage: s.stage, outcome: s.outcome, ...(s.detail !== undefined ? { detail: s.detail } : {}) }));
  return { reachedStage: result.reachedStage, stages, ...(result.compiledSpec ? { strategy: result.compiledSpec } : {}) };
}
