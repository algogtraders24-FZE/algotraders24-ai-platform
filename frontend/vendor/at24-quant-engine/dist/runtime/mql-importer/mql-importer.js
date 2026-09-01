import { createHash } from "node:crypto";
import { tokenize } from "./lexer.js";
import { parseMQL } from "./parser.js";
import { detectDialect } from "./dialect-detector.js";
import { analyzeMQLSemantics } from "./semantic-analyzer.js";
import { generateStrategyIR } from "./ir-generator.js";
/** Deterministic — sha256 of the raw source text, never the wall clock or a random UUID (Q0.8.50/51). */
export function computeSourceHash(sourceText) {
    return createHash("sha256").update(sourceText, "utf8").digest("hex");
}
function buildLineMap(sourceText) {
    const entries = [{ line: 1, startOffset: 0 }];
    for (let i = 0; i < sourceText.length; i++) {
        if (sourceText[i] === "\n")
            entries.push({ line: entries.length + 1, startOffset: i + 1 });
    }
    return entries;
}
function buildSourceDocument(sourceText, fileName, dialect, program) {
    const symbolTable = new Map();
    const includes = [];
    const properties = new Map();
    const functions = [];
    const globalVariables = [];
    const inputs = [];
    for (const node of program.body) {
        switch (node.kind) {
            case "IncludeDirective":
                includes.push(node.path);
                break;
            case "PropertyDirective":
                properties.set(node.name, node.value);
                break;
            case "InputDeclaration":
                inputs.push(node.name);
                symbolTable.set(node.name, "input");
                break;
            case "GlobalVariableDeclaration":
                for (const d of node.declarators) {
                    globalVariables.push(d.name);
                    symbolTable.set(d.name, "global-variable");
                }
                break;
            case "StructDeclaration":
                symbolTable.set(node.name, "struct");
                break;
            case "FunctionDeclaration":
                functions.push(node.name);
                symbolTable.set(node.name, "function");
                break;
            case "DefineDirective":
                break;
        }
    }
    return {
        sourceHash: computeSourceHash(sourceText),
        language: dialect,
        languageVersion: dialect === "MQL5" ? "5" : "4",
        fileName,
        sourceText,
        lineMap: buildLineMap(sourceText),
        symbolTable,
        includes,
        properties,
        functions,
        globalVariables,
        inputs,
        stateVariables: globalVariables, // Q0.8.17 — every global is, by MQL's own scoping rules, cross-bar state
    };
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
export function importMQLSource(input) {
    const tokens = tokenize(input.sourceText);
    const { program, diagnostics: parseDiagnostics } = parseMQL(tokens);
    const { dialect } = detectDialect(program, input.forcedDialect);
    const document = buildSourceDocument(input.sourceText, input.fileName, dialect, program);
    const { model, diagnostics: semanticDiagnostics } = analyzeMQLSemantics(program, dialect);
    const { ir, report } = generateStrategyIR(document, program, model, parseDiagnostics, semanticDiagnostics, input.options);
    return { document, program, model, ir, report };
}
