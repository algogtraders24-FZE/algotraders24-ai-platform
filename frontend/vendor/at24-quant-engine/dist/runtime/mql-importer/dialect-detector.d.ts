import type { ProgramNode } from "../../domain/mql-importer/ast.js";
import type { MQLDialect } from "../../domain/mql-importer/mql-source-document.js";
/**
 * Q0.8.7 — dialect is determined from ACTUAL language constructs (which
 * event functions are declared), never solely from the file extension or
 * name (Q0.8.7's explicit rule). An explicit `forcedDialect` override
 * (a caller-supplied parser mode) always wins when supplied.
 */
export declare function detectDialect(program: ProgramNode, forcedDialect?: MQLDialect): {
    dialect: MQLDialect;
    confidence: "EXPLICIT" | "CONSTRUCT_BASED" | "DEFAULTED";
};
