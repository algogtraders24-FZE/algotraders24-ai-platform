import type { ProgramNode } from "../../domain/mql-importer/ast.js";
import type { Diagnostic } from "../../domain/mql-importer/diagnostic.js";
import type { MQLSemanticModel } from "../../domain/mql-importer/semantic-model.js";
import type { MQLDialect } from "../../domain/mql-importer/mql-source-document.js";
/**
 * Q0.8's central rule: parsing and semantic interpretation are separate
 * passes. This function takes an already-built `ProgramNode` (produced by
 * `parser.ts`, with zero knowledge of trading semantics) and walks it
 * exactly once to build the `MQLSemanticModel` — the ONLY place in this
 * package that assigns trading meaning to MQL syntax.
 */
export declare function analyzeMQLSemantics(program: ProgramNode, dialect: MQLDialect): {
    model: MQLSemanticModel;
    diagnostics: readonly Diagnostic[];
};
