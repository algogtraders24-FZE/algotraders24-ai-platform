import type { AIStrategyCompilerInput } from "../../domain/strategy-ir/ai-boundary.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import { STRATEGY_IR_VERSION } from "../../domain/strategy-ir/version.js";
import { computeCanonicalHash } from "../determinism.js";

/**
 * Identity fields an AI generator's own JSON blob cannot supply
 * deterministically (a strategyId is an assignment, a timestamp is a
 * timestamp) — supplied by the CALLER, never invented by the compiler
 * itself (keeps compileAIStrategyToIR a pure function of its arguments,
 * Q0.7.53's determinism requirement). `strategyTimezone` is REQUIRED
 * here, not defaulted, because Q0.7.18 permits no implicit timezone
 * anywhere in the IR — an AI input that never mentions a timezone must
 * still have one supplied explicitly by whatever compiles it.
 */
export interface AICompilationIdentity {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly name: string;
  readonly strategyTimezone: string;
  readonly createdAt: number;
}

/**
 * Q0.7.46/47 — the ONLY path an AI-generated strategy may reach a
 * StrategyIR through. Pure and deterministic: same `input`+`identity`
 * always produces the same IR (Q0.7.53) — no randomness, no wall clock,
 * and NO confidence/probability field is read from or written into the
 * result (Q0.7.47). `sourceHash` is computed FROM the input itself
 * (there is no source text for an AI-generated strategy — the
 * structured input IS the source), so two textually-different AI
 * outputs that happen to describe the identical structured intent
 * produce the identical sourceHash.
 */
export function compileAIStrategyToIR(input: AIStrategyCompilerInput, identity: AICompilationIdentity): StrategyIR {
  const sourceHash = computeCanonicalHash(input);
  const translationHash = computeCanonicalHash({ input, identity: { strategyTimezone: identity.strategyTimezone } });

  return {
    strategyId: identity.strategyId,
    strategyVersion: identity.strategyVersion,
    sourcePlatform: "AI_GENERATED",
    sourceLanguage: "AT24-AI-Compiler-Input-JSON",
    sourceVersion: "1.0.0",
    sourceHash,
    irVersion: STRATEGY_IR_VERSION,
    metadata: { name: identity.name, description: input.intent, createdAt: identity.createdAt },
    instruments: input.instruments,
    timeframes: input.timeframes,
    timeframeSeries: input.timeframes.map((timeframe) => ({
      timeframe,
      role: "EXECUTION" as const,
      availabilityPolicy: "HTF_CLOSE_AVAILABLE" as const,
      alignmentPolicy: "CLOSE_ALIGNED" as const,
    })),
    parameters: [],
    indicators: input.indicators,
    conditions: [],
    entries: input.entryConditions.map((e, i) => ({
      id: `ai-entry-${i}`,
      direction: e.direction,
      condition: e.condition,
      sizingModel: input.risk.sizing,
      timing: "NEXT_BAR_OPEN" as const,
      executionType: "MARKET" as const,
    })),
    exits: input.exitConditions.map((e, i) => ({
      id: `ai-exit-${i}`,
      kind: "SIGNAL_EXIT" as const,
      condition: e.condition,
      ...(e.appliesTo !== undefined ? { appliesTo: e.appliesTo } : {}),
    })),
    positionManagement: {
      accountingMode: "NETTING",
      pyramiding: { allowPyramiding: false, sameDirectionBehavior: "REJECT", oppositeDirectionBehavior: "REVERSAL" },
      reversal: {
        buyToSell: "CLOSE_THEN_OPEN",
        sellToBuy: "CLOSE_THEN_OPEN",
        platformDefaultDescription: "AT24-native compiler default: AI-compiled strategies always close-then-open on a reversal signal, never silently reverse in place — an explicit choice, not an imported platform default (Q0.7.30)",
      },
    },
    timezone: { strategyTimezone: identity.strategyTimezone },
    repaintingModel: "NON_REPAINTING",
    realtimeHistoricalAsymmetry: { historicalVsRealtimeDiffers: false, barCloseVsIntrabarDiffers: false },
    barCloseSemantics: "ON_BAR_CLOSE",
    priceSource: "CLOSE",
    slTpReference: "SIGNAL_BAR_CLOSE",
    risk: input.risk,
    execution: { declared: input.executionAssumptions, platformDefaultsUsed: [] },
    dependencies: { symbols: [], timeframes: [] },
    provenance: {
      sourcePlatform: "AI_GENERATED",
      sourceHash,
      sourceVersion: "1.0.0",
      irVersion: STRATEGY_IR_VERSION,
      translationHash,
      semanticStatus: "EXACT",
      unsupportedSemantics: [],
      approximations: [],
    },
  };
}
