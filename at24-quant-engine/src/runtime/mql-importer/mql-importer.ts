import { createHash } from "node:crypto";
import type { MQLDialect, MQLSourceDocument, LineMapEntry } from "../../domain/mql-importer/mql-source-document.js";
import type { ProgramNode } from "../../domain/mql-importer/ast.js";
import type { MQLSemanticModel } from "../../domain/mql-importer/semantic-model.js";
import type { MQLImportReport } from "../../domain/mql-importer/import-report.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import { tokenize } from "./lexer.js";
import { parseMQL } from "./parser.js";
import { detectDialect } from "./dialect-detector.js";
import { analyzeMQLSemantics } from "./semantic-analyzer.js";
import { generateStrategyIR, type MQLImportOptions } from "./ir-generator.js";

/** Deterministic — sha256 of the raw source text, never the wall clock or a random UUID (Q0.8.50/51). */
export function computeSourceHash(sourceText: string): string {
  return createHash("sha256").update(sourceText, "utf8").digest("hex");
}

function buildLineMap(sourceText: string): readonly LineMapEntry[] {
  const entries: LineMapEntry[] = [{ line: 1, startOffset: 0 }];
  for (let i = 0; i < sourceText.length; i++) {
    if (sourceText[i] === "\n") entries.push({ line: entries.length + 1, startOffset: i + 1 });
  }
  return entries;
}

function buildSourceDocument(sourceText: string, fileName: string, dialect: MQLDialect, program: ProgramNode): MQLSourceDocument {
  const symbolTable = new Map<string, "input" | "global-variable" | "function" | "struct">();
  const includes: string[] = [];
  const properties = new Map<string, string>();
  const functions: string[] = [];
  const globalVariables: string[] = [];
  const inputs: string[] = [];

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
export function importMQLSource(input: MQLImportInput): MQLImportOutput {
  const tokens = tokenize(input.sourceText);
  const { program, diagnostics: parseDiagnostics } = parseMQL(tokens);
  const { dialect } = detectDialect(program, input.forcedDialect);
  const document = buildSourceDocument(input.sourceText, input.fileName, dialect, program);
  const { model, diagnostics: semanticDiagnostics } = analyzeMQLSemantics(program, dialect);
  const { ir, report } = generateStrategyIR(document, program, model, parseDiagnostics, semanticDiagnostics, input.options);
  return { document, program, model, ir, report };
}
