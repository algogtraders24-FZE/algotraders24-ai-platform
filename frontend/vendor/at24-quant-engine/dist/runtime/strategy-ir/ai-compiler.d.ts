import type { AIStrategyCompilerInput } from "../../domain/strategy-ir/ai-boundary.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
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
export declare function compileAIStrategyToIR(input: AIStrategyCompilerInput, identity: AICompilationIdentity): StrategyIR;
