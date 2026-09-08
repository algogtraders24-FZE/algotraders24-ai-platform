/**
 * P3.8 — Validation / Evidence Gate (docs/ALGO_TESTING_PRO_ROADMAP.md
 * section 9, docs/P3.8-VALIDATION-EVIDENCE-GATE.md). The generic,
 * strategy-source-agnostic lifecycle every registered strategy is
 * evaluated against. Every stage is a REAL, machine-checkable gate
 * backed by an already-existing engine capability (see the doc for the
 * exact mapping) — this module composes those facts into one ordered
 * result, it does not invent new judgment calls of its own.
 *
 * The critical rule this whole module exists to enforce (P3.6's G01
 * investigation is the concrete, real example that motivated it): a
 * strategy must not advance past a stage merely because the PREVIOUS
 * stage technically ran. An import that "succeeds" but produces a
 * placeholder, always-false entry condition must stop at EXECUTION_VALID
 * with a real, specific reason — never silently reach BACKTEST_VALID
 * having simulated nothing meaningful.
 */
export const STRATEGY_LIFECYCLE_STAGES = ["IMPORTED", "PARSED", "IR_VALID", "EXECUTION_VALID", "DATA_VALID", "BACKTEST_VALID", "REPRODUCIBLE", "EVIDENCE_VERIFIED"];
/**
 * Composes a full, ordered `StrategyLifecycleResult` from a caller-supplied
 * result per stage. Requires all 8 stages (a `Record`, not a partial
 * object) so a caller can never silently omit one — every consumer of
 * this module gets the complete picture or a compile error, never a
 * gap that reads as "not evaluated" by accident.
 */
export function buildLifecycleResult(stagesByName) {
    const stages = STRATEGY_LIFECYCLE_STAGES.map((stage) => stagesByName[stage]);
    let reachedStage = stages[0].stage;
    for (const s of stages) {
        if (s.outcome === "FAILED")
            break;
        reachedStage = s.stage;
    }
    const noFailures = stages.every((s) => s.outcome !== "FAILED");
    const fullyVerified = noFailures && reachedStage === "EVIDENCE_VERIFIED";
    return { stages, reachedStage, fullyVerified };
}
/**
 * The IMPORTED/PARSED/IR_VALID/EXECUTION_VALID stages for an
 * engine-reference strategy (authored directly as TypeScript, e.g.
 * Golden Strategy — see `reference/golden-strategy.ts`). There is no
 * external source text, no parser, no separately-generated IR to
 * validate — the StrategySpec IS the authored artifact, definitionally
 * structurally valid by TypeScript's own type system and this engine's
 * existing `validateStrategySpec()`. Recorded as NOT_APPLICABLE, not
 * PASSED — a real distinction (see StageOutcome's own doc comment): these
 * four gates exist to catch problems introduced BY the import/reduction
 * pipeline, a pipeline this strategy never goes through.
 */
export function engineReferenceImportStages() {
    const detail = "not applicable — authored directly as TypeScript in at24-quant-engine/src/reference/, never imported from external source text through the MQL/IR pipeline";
    return {
        IMPORTED: { stage: "IMPORTED", outcome: "NOT_APPLICABLE", detail },
        PARSED: { stage: "PARSED", outcome: "NOT_APPLICABLE", detail },
        IR_VALID: { stage: "IR_VALID", outcome: "NOT_APPLICABLE", detail },
        EXECUTION_VALID: { stage: "EXECUTION_VALID", outcome: "NOT_APPLICABLE", detail },
    };
}
