import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenize } from "../src/runtime/mql-importer/lexer.js";
import { parseMQL } from "../src/runtime/mql-importer/parser.js";
import { importMQLSource, computeSourceHash } from "../src/runtime/mql-importer/mql-importer.js";
import { computeCanonicalIRHash } from "../src/runtime/strategy-ir/ir-hash.js";
import { MQL_GOLDEN_FIXTURES, baseOptions } from "./fixtures/mql-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MQL_IMPORTER_RUNTIME_DIR = path.resolve(__dirname, "../src/runtime/mql-importer");

const FORBIDDEN_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /Date\.now\s*\(/, label: "Date.now()" },
  { pattern: /Math\.random\s*\(/, label: "Math.random()" },
  { pattern: /process\.env/, label: "process.env" },
  { pattern: /new Date\s*\(/, label: "new Date()" },
  { pattern: /crypto\.randomUUID/, label: "crypto.randomUUID" },
];

test("Q0.8.51 determinism: no wall-clock, randomness, or environment access anywhere in src/runtime/mql-importer", () => {
  const files = fs.readdirSync(MQL_IMPORTER_RUNTIME_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const contents = fs.readFileSync(path.join(MQL_IMPORTER_RUNTIME_DIR, file), "utf8");
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      assert.ok(!pattern.test(contents), `${file} must never use ${label} (crypto.createHash for sha256 hashing is fine — only Date.now/Math.random/process.env/new Date/crypto.randomUUID are forbidden)`);
    }
  }
});

test("Q0.8.50: parsing the same source 3 times produces byte-identical ASTs (deepEqual)", () => {
  const source = MQL_GOLDEN_FIXTURES.emaCrossover!;
  const a = parseMQL(tokenize(source));
  const b = parseMQL(tokenize(source));
  const c = parseMQL(tokenize(source));
  assert.deepEqual(a.program, b.program);
  assert.deepEqual(b.program, c.program);
});

test("Q0.8.50: importing the same source 3 times produces the identical semantic model and IR hash", () => {
  const source = MQL_GOLDEN_FIXTURES.marketBuy!;
  const options = baseOptions();
  const a = importMQLSource({ sourceText: source, fileName: "f.mq5", options });
  const b = importMQLSource({ sourceText: source, fileName: "f.mq5", options });
  const c = importMQLSource({ sourceText: source, fileName: "f.mq5", options });
  assert.deepEqual(a.model, b.model);
  assert.equal(computeCanonicalIRHash(a.ir), computeCanonicalIRHash(b.ir));
  assert.equal(computeCanonicalIRHash(b.ir), computeCanonicalIRHash(c.ir));
});

test("Q0.8.50: source hashing is a pure sha256 of the raw text — identical text always hashes identically, any byte change always hashes differently", () => {
  const h1 = computeSourceHash("void f() {}");
  const h2 = computeSourceHash("void f() {}");
  const h3 = computeSourceHash("void f() { }"); // one extra space
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("Q0.8.51 immutability: the parser never mutates the token array it was given", () => {
  const tokens = tokenize(MQL_GOLDEN_FIXTURES.rsi!);
  const frozenTokens = Object.freeze(tokens.map((t) => Object.freeze({ ...t, position: Object.freeze({ ...t.position }) })));
  assert.doesNotThrow(() => parseMQL(frozenTokens));
});

test("Q0.8.51 immutability: importMQLSource never mutates the sourceText string it was given (strings are immutable in JS, but the call must not throw or alias-mutate any input object)", () => {
  const options = Object.freeze({ ...baseOptions(), instrument: Object.freeze({ symbol: "EURUSD" }) });
  assert.doesNotThrow(() => importMQLSource({ sourceText: MQL_GOLDEN_FIXTURES.session!, fileName: "f.mq5", options }));
});
