// services/algo-test/quant-strategy-builder.service.ts
// QP-2 - Conversational Strategy Builder orchestration (locked decision:
// a lightweight, Quant-specific service directly around the EXISTING
// AIProvider / compileNaturalLanguageStrategy() - NOT a new AgentRuntime
// AgentType. No tool calls, no backtest.run, no market.intelligence, no
// autonomous loop - this only ever compiles and validates, mirroring
// algoTestService.compileAndRunAiStrategy()'s own provider-injection
// pattern minus the backtest step it deliberately never reaches).
//
// Every strategy modification - including a parameter-only change like
// "change RSI period from 14 to 21" - goes through the EXACT SAME
// compileNaturalLanguageStrategy() schema -> IR -> execution-validation
// pipeline every other AI-compiled strategy uses. There is deliberately
// NO direct StrategySpec-mutation path: the compiler/schema/IR boundary
// is the ONLY place untrusted (accumulated, user-edited) text becomes a
// trusted, executable StrategySpec - a locked QP-2 safety decision, not
// an oversight.
import { ClaudeProvider } from "@/lib/ai/providers/claude.provider";
import type { AIProvider } from "@/lib/ai/provider.interface";
import { compileNaturalLanguageStrategy, type CompileNaturalLanguageStrategyResult } from "./nl-strategy-compiler.service";
import type { StrategySpec } from "at24-quant-engine";
import type { QuantChatConversationState, QuantChatModificationKind, QuantChatTurn } from "@/types/quant-chat";

/**
 * Appends the new user turn to the running conversation as one cumulative
 * natural-language description, never a diff/patch instruction the
 * compiler itself was never designed to parse. The compiler's own system
 * prompt already expects one full, self-contained strategy description
 * (see lib/ai/strategy-compiler/prompt.ts) - so a modification turn is
 * phrased as "the strategy so far, plus this change" rather than the raw
 * turn text alone, which would lose everything decided in earlier turns.
 */
export function buildAccumulatedIntent(previousIntent: string, newUserText: string): string {
  if (previousIntent.trim().length === 0) return newUserText.trim();
  return `${previousIntent.trim()}\n\nAdditional instruction: ${newUserText.trim()}`;
}

/**
 * Best-effort structural diff between two compiled StrategySpecs, used
 * only as an informational label (QuantChatModificationKind) - never as
 * something a caller branches execution on. Returns "unknown" whenever
 * either spec is missing (a failed compile) or the comparison can't
 * confidently tell parameter-only from logic-changing, rather than
 * guessing (locked decision: don't fabricate precision the system can't
 * prove).
 */
export function classifyModification(previous: StrategySpec | undefined, next: StrategySpec | undefined): QuantChatModificationKind {
  if (!previous || !next) return "unknown";

  const structuralPrevious = { instruments: previous.instruments, timeframes: previous.timeframes, entryRules: previous.entryRules, exitRules: previous.exitRules };
  const structuralNext = { instruments: next.instruments, timeframes: next.timeframes, entryRules: next.entryRules, exitRules: next.exitRules };
  const structureChanged = JSON.stringify(structuralPrevious) !== JSON.stringify(structuralNext);

  const parametricPrevious = { risk: previous.risk, execution: previous.execution };
  const parametricNext = { risk: next.risk, execution: next.execution };
  const parametersChanged = JSON.stringify(parametricPrevious) !== JSON.stringify(parametricNext);

  if (structureChanged && parametersChanged) return "mixed";
  if (structureChanged) return "logic";
  if (parametersChanged) return "parameter";
  // Neither structural nor parametric fields differ (e.g. only metadata/
  // identity changed, or the recompile produced a byte-identical spec) -
  // genuinely not a meaningful modification either way, so "unknown" is
  // the honest label rather than either specific one.
  return "unknown";
}

export interface ApplyModificationInput {
  readonly userId: string;
  readonly state: QuantChatConversationState;
  readonly userText: string;
  readonly deps?: { provider?: AIProvider };
}

export interface ApplyModificationResult {
  readonly state: QuantChatConversationState;
  readonly run: CompileNaturalLanguageStrategyResult;
  readonly modificationKind: QuantChatModificationKind;
}

/**
 * Drives one MODIFY turn to completion: accumulate intent, call the
 * EXISTING compiler (unmodified), classify the resulting change, return
 * updated in-memory state. Never persists anything - the caller (the API
 * route) hands the returned state straight back to the client, which
 * holds it in React state only (locked decision: in-memory-only for v1).
 */
export async function applyModification(input: ApplyModificationInput): Promise<ApplyModificationResult> {
  const provider = input.deps?.provider ?? new ClaudeProvider();
  const accumulatedIntent = buildAccumulatedIntent(input.state.currentIntent, input.userText);
  const compiledAt = Date.now();

  const run = await compileNaturalLanguageStrategy(accumulatedIntent, provider, {
    userId: input.userId,
    strategyVersion: "1.0.0",
    name: accumulatedIntent.slice(0, 80),
    strategyTimezone: "UTC",
    createdAt: compiledAt,
  });

  const modificationKind = classifyModification(input.state.lastCompileResult?.compiledSpec, run.compiledSpec);

  const now = new Date().toISOString();
  const userTurn: QuantChatTurn = { role: "user", content: input.userText, mode: "modify", createdAt: now };
  const assistantTurn: QuantChatTurn = {
    role: "assistant",
    content:
      run.compiledSpec !== undefined
        ? `Compiled successfully (reached ${run.reachedStage}).`
        : `Could not compile (reached ${run.reachedStage}): ${run.stages.find((s) => s.outcome === "FAILED")?.detail ?? "see stage detail"}`,
    mode: "modify",
    modificationKind,
    createdAt: now,
  };

  return {
    state: {
      turns: [...input.state.turns, userTurn, assistantTurn],
      // Only advance the accumulated intent when compilation actually
      // succeeded - a failed attempt must not silently become part of the
      // strategy's own description for the next turn.
      currentIntent: run.compiledSpec !== undefined ? accumulatedIntent : input.state.currentIntent,
      lastCompileResult: run,
    },
    run,
    modificationKind,
  };
}
