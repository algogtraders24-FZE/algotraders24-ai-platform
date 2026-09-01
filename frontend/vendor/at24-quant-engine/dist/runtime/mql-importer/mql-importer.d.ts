import type { MQLDialect, MQLSourceDocument } from "../../domain/mql-importer/mql-source-document.js";
import type { ProgramNode } from "../../domain/mql-importer/ast.js";
import type { MQLSemanticModel } from "../../domain/mql-importer/semantic-model.js";
import type { MQLImportReport } from "../../domain/mql-importer/import-report.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import { type MQLImportOptions } from "./ir-generator.js";
/** Deterministic — sha256 of the raw source text, never the wall clock or a random UUID (Q0.8.50/51). */
export declare function computeSourceHash(sourceText: string): string;
export interface MQLImportInput {
    readonly sourceText: string;
    readonly fileName: string;
    readonly options: MQLImportOptions;
    readonly forcedDialect?: MQLDialect;
}
export interface MQLImportOutput {
    readonly document: MQLSourceDocument;
    readonly program: ProgramNode;
    readonly model: MQLSemanticModel;
    readonly ir: StrategyIR;
    readonly report: MQLImportReport;
}
/**
 * Q0.8's single public entry point, composing the fully SEPARATE stages
 * the critical rule mandates: lex -> parse (structure only, no meaning)
 * -> dialect detection -> semantic analysis (meaning, still no IR
 * shape) -> IR generation (reduction into Q0.7's StrategyIR). Pure and
 * deterministic — the only "identity" facts not derivable from
 * `sourceText` itself (`strategyId`, `instrument`, `executionTimeframe`,
 * `importedAt`) are required, explicit caller-supplied options, never
 * invented (mirrors Q0.7's `compileAIStrategyToIR()` requiring an
 * explicit `strategyTimezone` for the same reason).
 */
export declare function importMQLSource(input: MQLImportInput): MQLImportOutput;
