import type { MQLImportOutput } from "./mql-importer.js";
import { blockingDiagnostics } from "../../domain/mql-importer/import-report.js";
import { validateStrategyIRStructure } from "../../domain/strategy-ir/strategy-ir.js";
import { checkReductionEligibility } from "../reduction/eligibility-gate.js";
import type { StageResult, StrategyLifecycleStage } from "../../domain/strategy-lifecycle.js";

/**
 * P3.8 — the IMPORTED/PARSED/IR_VALID/EXECUTION_VALID stages for an
 * MQL-imported strategy, composed from facts `importMQLSource()` already
 * computes (`report.diagnostics`, `ir`) — never a new judgment call, this
 * function only reads and structures existing signals:
 *
 * - IMPORTED: the lexer/parser/semantic-analyzer/ir-generator pipeline
 *   completed and produced a document+report at all (this importer is
 *   deliberately never-throws — genuine failures degrade to diagnostics,
 *   not exceptions — so reaching this function at all already means
 *   IMPORTED passed; it exists as its own named stage for symmetry with
 *   the roadmap's own lifecycle, not because it can independently fail
 *   here).
 * - PARSED: zero BLOCKING diagnostics in `report.diagnostics`
 *   (`blockingDiagnostics()`, `domain/mql-importer/import-report.ts`'s
 *   own doc comment: "the ONLY condition under which the resulting
 *   StrategyIR may be execution-eligible").
 * - IR_VALID: `validateStrategyIRStructure(ir).valid` — structural
 *   validity only, independent of execution eligibility.
 * - EXECUTION_VALID: `checkReductionEligibility(ir).eligible` — this is
 *   the gate that actually catches a placeholder/always-false condition
 *   (G01's real failure mode, confirmed empirically in P3.6 — see
 *   docs/P3.6-MULTI-STRATEGY-REGISTRY.md section 2): the ir-generator's
 *   own `markUnsupported(..., "BLOCKING", ...)` for an unrepresentable
 *   entry condition feeds into `ir.provenance.unsupportedSemantics`,
 *   which `checkReductionEligibility` (via `validateStrategyIR`) already
 *   refuses to pass.
 */
export function mqlImportLifecycleStages(output: MQLImportOutput): Pick<Record<StrategyLifecycleStage, StageResult>, "IMPORTED" | "PARSED" | "IR_VALID" | "EXECUTION_VALID"> {
  const blocking = blockingDiagnostics(output.report);

  const IMPORTED: StageResult = { stage: "IMPORTED", outcome: "PASSED", detail: `source accepted, sourceHash ${output.document.sourceHash.slice(0, 16)}...` };

  if (blocking.length > 0) {
    const detail = blocking.map((d) => `${d.code}: ${d.message}`).join("; ");
    const failed: StageResult = { stage: "PARSED", outcome: "FAILED", detail };
    return {
      IMPORTED,
      PARSED: failed,
      IR_VALID: { stage: "IR_VALID", outcome: "FAILED", detail: "not evaluated — PARSED already failed" },
      EXECUTION_VALID: { stage: "EXECUTION_VALID", outcome: "FAILED", detail: "not evaluated — PARSED already failed" },
    };
  }
  const PARSED: StageResult = { stage: "PARSED", outcome: "PASSED", detail: `${output.report.diagnostics.length} diagnostic(s), zero BLOCKING` };

  const structural = validateStrategyIRStructure(output.ir);
  if (!structural.valid) {
    const detail = structural.errors.join("; ");
    const failed: StageResult = { stage: "IR_VALID", outcome: "FAILED", detail };
    return { IMPORTED, PARSED, IR_VALID: failed, EXECUTION_VALID: { stage: "EXECUTION_VALID", outcome: "FAILED", detail: "not evaluated — IR_VALID already failed" } };
  }
  const IR_VALID: StageResult = { stage: "IR_VALID", outcome: "PASSED" };

  const eligibility = checkReductionEligibility(output.ir);
  if (!eligibility.eligible) {
    return { IMPORTED, PARSED, IR_VALID, EXECUTION_VALID: { stage: "EXECUTION_VALID", outcome: "FAILED", detail: eligibility.blockingReasons.join("; ") } };
  }

  return { IMPORTED, PARSED, IR_VALID, EXECUTION_VALID: { stage: "EXECUTION_VALID", outcome: "PASSED" } };
}
