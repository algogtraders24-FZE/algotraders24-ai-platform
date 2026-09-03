// services/algo-test/nl-strategy-compiler.service.ts
// P4 - Natural Language -> Universal Strategy IR
// (docs/ALGO_TESTING_PRO_ROADMAP.md section 10,
// docs/P4-NL-STRATEGY-COMPILER.md). Phase 1 scope, confirmed before
// implementation: compile -> validate -> structured review data. Does
// NOT wire backtest execution this phase (the user's own stated Phase 1
// boundary) - `compiledSpec`/`buildIndicatorSeries` are returned ready
// for a caller to hand to the EXISTING, unmodified generic
// run-backtest.ts (P3.6) once a human has reviewed and approved the
// compilation, a natural, small follow-up this phase deliberately leaves
// for later rather than rushing.
//
// The IR is the ONLY safety/control boundary an LLM's output crosses
// through - never direct execution of AI-authored logic. Concretely:
// LLM free text -> parseAIStrategyCompilerInput() (schema.ts, a real,
// defensive structural validator - untrusted JSON is never assumed
// well-shaped) -> compileAIStrategyToIR() (at24-quant-engine's own
// Q0.7.46 boundary, unmodified, already tested since Q0.7) ->
// validateStrategyIRStructure()/checkReductionEligibility() (the SAME
// P3.8 lifecycle functions every other strategy source goes through,
// never a parallel/looser check for AI output).
import {
  compileAIStrategyToIR,
  validateStrategyIRStructure,
  checkReductionEligibility,
  reduceStrategyIRToSpec,
  calculateSeries,
  ema,
  sma,
  rsi,
  atr,
  indicator,
  indicatorKey,
  type StrategyIR,
  type StrategySpec,
  type StageResult,
  type StrategyLifecycleStage,
  type OHLCVBar,
  type NamedIndicatorFamily,
} from "at24-quant-engine";
import type { AIProvider } from "@/lib/ai/provider.interface";
import { STRATEGY_COMPILER_SYSTEM_PROMPT, buildStrategyCompilerUserPrompt } from "@/lib/ai/strategy-compiler/prompt";
import { parseAIStrategyCompilerInput, type SchemaIssue } from "@/lib/ai/strategy-compiler/schema";

export interface CompileNaturalLanguageStrategyResult {
  /** In canonical order, exactly IMPORTED..EXECUTION_VALID (the four stages this function can determine without real market data/a backtest) - see buildRunLifecycle() in algo-test.service.ts for how the remaining four are added once (if) this compiled strategy is actually backtested. */
  readonly stages: readonly StageResult[];
  readonly reachedStage: StrategyLifecycleStage;
  /** Present only once EXECUTION_VALID has PASSED - a compiled strategy that never reached that stage has nothing safe to review or run. */
  readonly compiledSpec?: StrategySpec;
  readonly compiledIR?: StrategyIR;
  readonly buildIndicatorSeries?: (bars: readonly OHLCVBar[]) => ReadonlyMap<string, readonly (number | boolean | undefined)[]>;
  /** The raw LLM text, kept for audit/debugging - never re-parsed by a caller, `compiledSpec` is the only thing safe to execute. */
  readonly rawResponse: string;
}

const INDICATOR_DEFINITIONS: Readonly<Record<NamedIndicatorFamily, unknown>> = { SMA: sma, EMA: ema, RSI: rsi, ATR: atr, MACD: undefined, BOLLINGER_BANDS: undefined };

function extractJsonObject(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  // Defensive against the most common real deviations from "respond with
  // ONLY the JSON object" - a fenced code block, or the object embedded
  // in surrounding prose despite the system prompt's own instruction not
  // to add any. Never attempts a "best guess" repair of malformed JSON
  // itself (e.g. trailing commas) - if the extracted substring doesn't
  // parse, that is a real, honest PARSED-stage failure, not something to
  // silently patch around.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]!.trim() : text.trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  const jsonSlice = firstBrace !== -1 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  try {
    return { ok: true, value: JSON.parse(jsonSlice) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function issuesToDetail(issues: readonly SchemaIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join("; ");
}

/** Builds an indicatorSeries map generically from a compiled strategy's own declared, engine-implemented, single-output indicators - the SAME calculateSeries() fold (runtime/indicator-engine.ts) every other registry entry's own indicator builder already uses, dispatched by family via a lookup table instead of hand-written per strategy. Includes the PRICE pseudo-indicator unconditionally (Golden Strategy's own established convention) since the schema allows referencing it without a declared entry. */
function buildIndicatorSeriesFromCompiledIndicators(indicators: readonly { readonly family: string; readonly params: readonly number[] }[]): (bars: readonly OHLCVBar[]) => ReadonlyMap<string, readonly (number | boolean | undefined)[]> {
  return (bars) => {
    const series = new Map<string, readonly (number | boolean | undefined)[]>();
    series.set(indicatorKey(indicator("PRICE")), bars.map((b) => b.close));
    for (const ind of indicators) {
      const def = INDICATOR_DEFINITIONS[ind.family as NamedIndicatorFamily];
      if (!def) continue; // structurally unreachable for a compilation that reached EXECUTION_VALID - schema.ts only ever accepts SMA/EMA/RSI/ATR, all of which have a real entry above.
      const values = calculateSeries(def as Parameters<typeof calculateSeries>[0], bars, { period: ind.params[0]! }).map((v) => (typeof v === "number" ? v : undefined));
      series.set(namedIndicatorKeyLocal(ind.family, ind.params), values);
    }
    return series;
  };
}

function namedIndicatorKeyLocal(family: string, params: readonly number[]): string {
  return `${family}(${params.join(",")})`;
}

const FIRST_FOUR_STAGES = ["IMPORTED", "PARSED", "IR_VALID", "EXECUTION_VALID"] as const;

/** Same "last PASSED/NOT_APPLICABLE stage before the first FAILED one" rule as buildLifecycleResult() (domain/strategy-lifecycle.ts), scoped to just these 4 stages - this function never has the remaining 4 (DATA_VALID onward) available, since no backtest has run yet (Phase 1's own deliberate boundary). */
function reachedStageAmongFirstFour(byName: Partial<Record<StrategyLifecycleStage, StageResult>>): StrategyLifecycleStage {
  let reached: StrategyLifecycleStage = "IMPORTED";
  for (const stage of FIRST_FOUR_STAGES) {
    const s = byName[stage];
    if (!s || s.outcome === "FAILED") break;
    reached = stage;
  }
  return reached;
}

function toStages(byName: Partial<Record<StrategyLifecycleStage, StageResult>>): readonly StageResult[] {
  return FIRST_FOUR_STAGES.map((stage) => byName[stage]!);
}

export async function compileNaturalLanguageStrategy(intent: string, provider: AIProvider, identity: { strategyId: string; strategyVersion: string; name: string; strategyTimezone: string; createdAt: number }): Promise<CompileNaturalLanguageStrategyResult> {
  const completion = await provider.complete({
    messages: [
      { role: "system", content: STRATEGY_COMPILER_SYSTEM_PROMPT },
      { role: "user", content: buildStrategyCompilerUserPrompt(intent) },
    ],
    temperature: 0,
  });

  const byName: Partial<Record<StrategyLifecycleStage, StageResult>> = {};
  byName.IMPORTED = { stage: "IMPORTED", outcome: "PASSED", detail: `${provider.name} responded, ${completion.content.length} char(s)` };

  const extracted = extractJsonObject(completion.content);
  if (!extracted.ok) {
    byName.PARSED = { stage: "PARSED", outcome: "FAILED", detail: `response was not valid JSON: ${extracted.reason}` };
    for (const s of ["IR_VALID", "EXECUTION_VALID"] as const) byName[s] = { stage: s, outcome: "FAILED", detail: "not evaluated — PARSED already failed" };
    return { stages: toStages(byName), reachedStage: reachedStageAmongFirstFour(byName), rawResponse: completion.content };
  }

  const parsed = parseAIStrategyCompilerInput(extracted.value);
  if (!parsed.ok) {
    byName.PARSED = { stage: "PARSED", outcome: "FAILED", detail: issuesToDetail(parsed.issues) };
    for (const s of ["IR_VALID", "EXECUTION_VALID"] as const) byName[s] = { stage: s, outcome: "FAILED", detail: "not evaluated — PARSED already failed" };
    return { stages: toStages(byName), reachedStage: reachedStageAmongFirstFour(byName), rawResponse: completion.content };
  }
  byName.PARSED = { stage: "PARSED", outcome: "PASSED", detail: `${parsed.value.entryConditions.length} entry rule(s), ${parsed.value.indicators.length} indicator(s)` };

  const ir = compileAIStrategyToIR(
    {
      ...parsed.value,
      // Fixed server-side, never LLM-supplied - see schema.ts's own doc comment on why.
      executionAssumptions: { fillModel: "next-bar-open", costsExplicitlyZero: true },
    },
    identity,
  );

  const structural = validateStrategyIRStructure(ir);
  if (!structural.valid) {
    byName.IR_VALID = { stage: "IR_VALID", outcome: "FAILED", detail: structural.errors.join("; ") };
    byName.EXECUTION_VALID = { stage: "EXECUTION_VALID", outcome: "FAILED", detail: "not evaluated — IR_VALID already failed" };
    return { stages: toStages(byName), reachedStage: reachedStageAmongFirstFour(byName), compiledIR: ir, rawResponse: completion.content };
  }
  byName.IR_VALID = { stage: "IR_VALID", outcome: "PASSED" };

  const eligibility = checkReductionEligibility(ir);
  if (!eligibility.eligible) {
    byName.EXECUTION_VALID = { stage: "EXECUTION_VALID", outcome: "FAILED", detail: eligibility.blockingReasons.join("; ") };
    return { stages: toStages(byName), reachedStage: reachedStageAmongFirstFour(byName), compiledIR: ir, rawResponse: completion.content };
  }
  byName.EXECUTION_VALID = { stage: "EXECUTION_VALID", outcome: "PASSED" };

  const reduction = reduceStrategyIRToSpec(ir);
  if (reduction.status === "BLOCKED" || !reduction.strategySpec) {
    // Structurally unreachable given eligibility already passed (same
    // "checked twice on purpose" discipline as ref-ema-crossover-strategy.ts) -
    // kept as a real guard, never a non-null assertion.
    byName.EXECUTION_VALID = { stage: "EXECUTION_VALID", outcome: "FAILED", detail: `reduction was BLOCKED despite passing eligibility: ${reduction.diagnostics.join("; ")}` };
    return { stages: toStages(byName), reachedStage: reachedStageAmongFirstFour(byName), compiledIR: ir, rawResponse: completion.content };
  }

  return {
    stages: toStages(byName),
    reachedStage: reachedStageAmongFirstFour(byName),
    compiledSpec: reduction.strategySpec,
    compiledIR: ir,
    // schema.ts's own validator only ever produces {kind:"named",...} entries (the "generic" IndicatorCall variant is never emitted) - narrowed explicitly rather than cast, so a future change to schema.ts that DID emit "generic" would fail loudly here instead of silently mis-reading .family/.params off the wrong union member.
    buildIndicatorSeries: buildIndicatorSeriesFromCompiledIndicators(parsed.value.indicators.filter((i) => i.kind === "named").map((i) => ({ family: i.family, params: i.params as readonly number[] }))),
    rawResponse: completion.content,
  };
}
