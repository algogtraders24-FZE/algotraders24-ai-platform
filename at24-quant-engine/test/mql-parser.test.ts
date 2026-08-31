import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/runtime/mql-importer/lexer.js";
import { parseMQL } from "../src/runtime/mql-importer/parser.js";
import type { FunctionDeclarationNode, InputDeclarationNode, GlobalVariableDeclarationNode, StructDeclarationNode } from "../src/domain/mql-importer/ast.js";

function parse(source: string) {
  return parseMQL(tokenize(source));
}

test("Q0.8.4: #include/#define/#property parse into distinct top-level nodes", () => {
  const { program, diagnostics } = parse('#include <Trade\\Trade.mqh>\n#property strict\n#define FOO 1\n');
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.equal(program.body.length, 3);
  assert.equal(program.body[0]!.kind, "IncludeDirective");
  assert.equal(program.body[1]!.kind, "PropertyDirective");
  assert.equal(program.body[2]!.kind, "DefineDirective");
});

test("Q0.8.1: an input declaration with a trailing comment is captured, including its default value expression", () => {
  const { program } = parse('input long InpMagicNumber = 24001; // Magic number\n');
  const node = program.body[0] as InputDeclarationNode;
  assert.equal(node.kind, "InputDeclaration");
  assert.equal(node.declType, "long");
  assert.equal(node.name, "InpMagicNumber");
  assert.equal(node.defaultValue.kind, "Literal");
  assert.equal(node.comment, "Magic number");
});

test("global variable declarations (scalar, array, struct-typed) all parse without error", () => {
  const { program, diagnostics } = parse("CTrade g_trade;\nint g_dailyTradeCount = 0;\nSSwingPoint g_m15Highs[];\n");
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.equal(program.body.length, 3);
  const arr = program.body[2] as GlobalVariableDeclarationNode;
  assert.equal(arr.declarators[0]!.isArray, true);
  assert.equal(arr.declType, "SSwingPoint");
});

test("comma-separated multi-declarator statements parse correctly (a real G01 pattern: `SBar prevDay,prevWeek;`)", () => {
  const { program, diagnostics } = parse("void f() { SBar prevDay,prevWeek; }");
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const fn = program.body[0] as FunctionDeclarationNode;
  const decl = fn.body.body[0] as import("../src/domain/mql-importer/ast.js").VariableDeclarationStatementNode;
  assert.equal(decl.declarators.length, 2);
  assert.equal(decl.declarators[0]!.name, "prevDay");
  assert.equal(decl.declarators[1]!.name, "prevWeek");
});

test("MQL5's `input group \"Section\"` UI-organization directive (no trailing semicolon in real MQL5) parses without a spurious BLOCKING diagnostic", () => {
  const { program, diagnostics } = parse('input group "=== Identification ==="\ninput long InpMagicNumber = 24001;\n');
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.equal(program.body.length, 2);
  assert.equal(program.body[0]!.kind, "PropertyDirective");
  assert.equal(program.body[1]!.kind, "InputDeclaration");
});

test("struct declarations parse their fields", () => {
  const { program } = parse("struct SPendingCSVRow\n{\n bool active;\n datetime timestamp;\n double sl;\n};\n");
  const node = program.body[0] as StructDeclarationNode;
  assert.equal(node.kind, "StructDeclaration");
  assert.equal(node.name, "SPendingCSVRow");
  assert.equal(node.fields.length, 3);
  assert.equal(node.fields[0]!.name, "active");
});

test("a function with if/else, return, and expression statements parses into a full body", () => {
  const { program, diagnostics } = parse(`
    int OnInit()
      {
       if(InpMagicNumber <= 0)
          return(INIT_FAILED);
       g_state = STATE_IDLE;
       return(INIT_SUCCEEDED);
      }
  `);
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const fn = program.body[0] as FunctionDeclarationNode;
  assert.equal(fn.kind, "FunctionDeclaration");
  assert.equal(fn.name, "OnInit");
  assert.equal(fn.body.body.length, 3);
  assert.equal(fn.body.body[0]!.kind, "IfStatement");
  assert.equal(fn.body.body[2]!.kind, "ReturnStatement");
});

test("member/call/index expressions all parse correctly (g_trade.Buy(lots,_Symbol,0.0,sl,tp,\"c\"))", () => {
  const { program, diagnostics } = parse(`
    void f()
      {
       bool sent = g_trade.Buy(lots,_Symbol,0.0,sl,tp,"AT24_G01");
       double x = arr[0];
      }
  `);
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const fn = program.body[0] as FunctionDeclarationNode;
  const decl = fn.body.body[0] as import("../src/domain/mql-importer/ast.js").VariableDeclarationStatementNode;
  assert.equal(decl.declarators[0]!.initializer!.kind, "CallExpression");
  if (decl.declarators[0]!.initializer!.kind === "CallExpression") {
    assert.equal(decl.declarators[0]!.initializer!.callee.kind, "MemberExpression");
    assert.equal(decl.declarators[0]!.initializer!.args.length, 6);
  }
});

test("a for-loop over PositionsTotal() parses (position-scanning pattern from G01)", () => {
  const { program, diagnostics } = parse(`
    bool f()
      {
       for(int i=PositionsTotal()-1; i>=0; i--)
         {
          ulong ticket = PositionGetTicket(i);
         }
       return(false);
      }
  `);
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const fn = program.body[0] as FunctionDeclarationNode;
  assert.equal(fn.body.body[0]!.kind, "ForStatement");
});

test("Q0.8.5: a switch statement is skip-recovered (UnparsedStatement + WARNING), never crashes the parser", () => {
  const { program, diagnostics } = parse(`
    void f(int reasonRaw)
      {
       string exitReason;
       switch(reasonRaw)
         {
          case 1: exitReason = "SL"; break;
          case 2: exitReason = "TP"; break;
          default: exitReason = "OTHER"; break;
         }
       Print(exitReason);
      }
  `);
  const fn = program.body[0] as FunctionDeclarationNode;
  const kinds = fn.body.body.map((s) => s.kind);
  assert.ok(kinds.includes("UnparsedStatement"));
  assert.ok(kinds.includes("ExpressionStatement")); // the Print(...) call after the switch still parses
  assert.ok(diagnostics.some((d) => d.code === "UNPARSED_STATEMENT" && d.severity === "WARNING"));
});

test("ternary expressions parse correctly", () => {
  const { program, diagnostics } = parse('void f() { string s = (profit >= 0.0) ? "WIN" : "LOSS"; }');
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const fn = program.body[0] as FunctionDeclarationNode;
  const decl = fn.body.body[0] as import("../src/domain/mql-importer/ast.js").VariableDeclarationStatementNode;
  assert.equal(decl.declarators[0]!.initializer!.kind, "ConditionalExpression");
});

test("C-style casts parse without being mistaken for a parenthesized expression", () => {
  const { program, diagnostics } = parse("void f() { long m = (long)PositionGetInteger(POSITION_MAGIC); }");
  assert.equal(diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const fn = program.body[0] as FunctionDeclarationNode;
  const decl = fn.body.body[0] as import("../src/domain/mql-importer/ast.js").VariableDeclarationStatementNode;
  assert.equal(decl.declarators[0]!.initializer!.kind, "UnaryExpression");
});

test("every AST node produced carries an exact source position (Q0.8.43's trace requirement starts here)", () => {
  const { program } = parse("input int InpPeriod = 14;\n");
  const node = program.body[0] as InputDeclarationNode;
  assert.equal(node.position.line, 1);
  assert.ok(node.position.column >= 1);
});
