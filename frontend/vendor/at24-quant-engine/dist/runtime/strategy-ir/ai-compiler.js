import { STRATEGY_IR_VERSION } from "../../domain/strategy-ir/version.js";
import { computeCanonicalHash } from "../determinism.js";
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
export function compileAIStrategyToIR(input, identity) {
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
            role: "EXECUTION",
            availabilityPolicy: "HTF_CLOSE_AVAILABLE",
            alignmentPolicy: "CLOSE_ALIGNED",
        })),
        parameters: [],
        indicators: input.indicators,
        conditions: [],
        entries: input.entryConditions.map((e, i) => ({
            id: `ai-entry-${i}`,
            direction: e.direction,
            condition: e.condition,
            sizingModel: input.risk.sizing,
            timing: "NEXT_BAR_OPEN",
            executionType: "MARKET",
        })),
        exits: input.exitConditions.map((e, i) => ({
            id: `ai-exit-${i}`,
            kind: "SIGNAL_EXIT",
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
