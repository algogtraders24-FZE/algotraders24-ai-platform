/** Q0.8.7 — explicit, never inferred solely from filename (Q0.8.7's rule). */
export type MQLDialect = "MQL4" | "MQL5";
export interface LineMapEntry {
    readonly line: number;
    readonly startOffset: number;
}
/**
 * Q0.8.1 — the raw-source-level facts a lexer/parser establishes before
 * any semantic interpretation begins. `symbolTable` is populated
 * incrementally by the parser (every declared name -> what kind of
 * declaration introduced it) so later semantic analysis never has to
 * re-scan the AST just to answer "is this identifier a global, an
 * input, or a function."
 */
export interface MQLSourceDocument {
    readonly sourceHash: string;
    readonly language: MQLDialect;
    readonly languageVersion: string;
    readonly fileName: string;
    readonly sourceText: string;
    readonly lineMap: readonly LineMapEntry[];
    readonly symbolTable: ReadonlyMap<string, "input" | "global-variable" | "function" | "struct">;
    readonly includes: readonly string[];
    readonly properties: ReadonlyMap<string, string>;
    readonly functions: readonly string[];
    readonly globalVariables: readonly string[];
    readonly inputs: readonly string[];
    readonly stateVariables: readonly string[];
}
