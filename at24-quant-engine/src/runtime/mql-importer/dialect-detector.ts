import type { ProgramNode, FunctionDeclarationNode } from "../../domain/mql-importer/ast.js";
import type { MQLDialect } from "../../domain/mql-importer/mql-source-document.js";

const MQL5_ONLY_EVENTS = new Set(["OnInit", "OnDeinit", "OnTick", "OnTimer", "OnTrade", "OnTradeTransaction", "OnBookEvent", "OnChartEvent"]);
const MQL4_STYLE_EVENTS = new Set(["init", "start", "deinit"]);

/**
 * Q0.8.7 — dialect is determined from ACTUAL language constructs (which
 * event functions are declared), never solely from the file extension or
 * name (Q0.8.7's explicit rule). An explicit `forcedDialect` override
 * (a caller-supplied parser mode) always wins when supplied.
 */
export function detectDialect(program: ProgramNode, forcedDialect?: MQLDialect): { dialect: MQLDialect; confidence: "EXPLICIT" | "CONSTRUCT_BASED" | "DEFAULTED" } {
  if (forcedDialect) return { dialect: forcedDialect, confidence: "EXPLICIT" };

  const functionNames = new Set(program.body.filter((n): n is FunctionDeclarationNode => n.kind === "FunctionDeclaration").map((f) => f.name));

  const hasMQL5Event = [...functionNames].some((n) => MQL5_ONLY_EVENTS.has(n));
  const hasMQL4Event = [...MQL4_STYLE_EVENTS].some((n) => functionNames.has(n));

  if (hasMQL5Event && !hasMQL4Event) return { dialect: "MQL5", confidence: "CONSTRUCT_BASED" };
  if (hasMQL4Event && !hasMQL5Event) return { dialect: "MQL4", confidence: "CONSTRUCT_BASED" };

  // Ambiguous or neither present — MQL5 is the safer default (superset of
  // modern syntax this parser targets), but confidence is honestly
  // reported as DEFAULTED, never silently treated as CONSTRUCT_BASED.
  return { dialect: "MQL5", confidence: "DEFAULTED" };
}
