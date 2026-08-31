import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/runtime/mql-importer/lexer.js";

function typesOf(source: string): string[] {
  return tokenize(source).map((t) => t.type);
}
function valuesOf(source: string): string[] {
  return tokenize(source).map((t) => t.value);
}

test("Q0.8.2: recognizes identifiers, keywords, numbers, strings, operators, punctuation", () => {
  const tokens = tokenize('input int InpPeriod = 14; string s = "hi";');
  assert.deepEqual(
    tokens.map((t) => t.type),
    ["KEYWORD", "KEYWORD", "IDENTIFIER", "OPERATOR", "NUMBER", "PUNCTUATION", "KEYWORD", "IDENTIFIER", "OPERATOR", "STRING", "PUNCTUATION", "EOF"],
  );
});

test("Q0.8.2: line comments and block comments are tokenized, not silently dropped from the stream", () => {
  const tokens = tokenize("int x; // trailing\n/* block */ int y;");
  const comments = tokens.filter((t) => t.type === "COMMENT");
  assert.equal(comments.length, 2);
  assert.equal(comments[0]!.value, "// trailing");
  assert.equal(comments[1]!.value, "/* block */");
});

test("Q0.8.4: #include/#define/#property are single PREPROCESSOR tokens capturing the whole directive line", () => {
  const tokens = tokenize('#include <Trade\\Trade.mqh>\n#define FOO 1\n#property strict\n');
  const preproc = tokens.filter((t) => t.type === "PREPROCESSOR");
  assert.equal(preproc.length, 3);
  assert.equal(preproc[0]!.value, "#include <Trade\\Trade.mqh>");
  assert.equal(preproc[1]!.value, "#define FOO 1");
  assert.equal(preproc[2]!.value, "#property strict");
});

test("Q0.8.3: token positions are exact (line/column/offset)", () => {
  const tokens = tokenize("int x;\nint y;");
  const secondInt = tokens.find((t, i) => t.value === "int" && i > 0)!;
  assert.equal(secondInt.position.line, 2);
  assert.equal(secondInt.position.column, 1);
  assert.equal(secondInt.position.offset, 7);
});

test("Q0.8.2: numeric literals (int, decimal, hex, scientific)", () => {
  assert.deepEqual(valuesOf("14 0.25 0x1A 1.5e-3"), ["14", "0.25", "0x1A", "1.5e-3", ""]);
});

test("Q0.8.2: string literals preserve escape sequences verbatim, not interpreted", () => {
  const tokens = tokenize('"line1\\nline2"');
  assert.equal(tokens[0]!.value, "line1\\nline2");
});

test("Q0.8.2: multi-char operators are matched longest-first (== not = =)", () => {
  assert.deepEqual(typesOf("a == b"), ["IDENTIFIER", "OPERATOR", "IDENTIFIER", "EOF"]);
  assert.equal(valuesOf("a == b")[1], "==");
  assert.equal(valuesOf("a <<= b")[1], "<<=");
});

test("Q0.8.2: real G01-style line tokenizes correctly end to end", () => {
  const tokens = tokenize('input long InpMagicNumber = 24001; // Magic number');
  assert.deepEqual(
    tokens.map((t) => t.value).filter((v) => v !== ""),
    ["input", "long", "InpMagicNumber", "=", "24001", ";", "// Magic number"],
  );
});
