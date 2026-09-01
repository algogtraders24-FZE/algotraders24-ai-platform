import type { Instrument, Timeframe } from "../../domain/market-data.js";
import type { ProgramNode } from "../../domain/mql-importer/ast.js";
import type { MQLSourceDocument } from "../../domain/mql-importer/mql-source-document.js";
import type { MQLSemanticModel } from "../../domain/mql-importer/semantic-model.js";
import type { Diagnostic } from "../../domain/mql-importer/diagnostic.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { MQLImportReport } from "../../domain/mql-importer/import-report.js";
export interface MQLImportOptions {
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly instrument: Instrument;
    readonly executionTimeframe: Timeframe;
    readonly importedAt: number;
}
/**
 * Q0.8's central rule restated: this function assigns NO new trading
 * meaning of its own — every field below traces directly to something
 * `semantic-analyzer.ts` already recorded, or is explicitly marked
 * unresolved/approximated. It is a REDUCTION step (semantic model ->
 * IR shape), not a second semantic-interpretation pass.
 */
export declare function generateStrategyIR(document: MQLSourceDocument, program: ProgramNode, model: MQLSemanticModel, parseDiagnostics: readonly Diagnostic[], semanticDiagnostics: readonly Diagnostic[], options: MQLImportOptions): {
    ir: StrategyIR;
    report: MQLImportReport;
};
