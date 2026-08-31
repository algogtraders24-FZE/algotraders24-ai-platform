import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { FIXTURE_A_PARENT_BARS, buildFixtureAD1Config, buildFixtureAD2Config } from "./fixtures/fidelity-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIDELITY_RUNTIME_DIR = path.resolve(__dirname, "../src/runtime/fidelity");

const FORBIDDEN_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /Date\.now\s*\(/, label: "Date.now()" },
  { pattern: /Math\.random\s*\(/, label: "Math.random()" },
  { pattern: /process\.env/, label: "process.env" },
  { pattern: /new Date\s*\(/, label: "new Date()" },
  { pattern: /crypto\.randomUUID/, label: "crypto.randomUUID" },
];

test("Q0.6 determinism: no wall-clock, randomness, or environment access anywhere in src/runtime/fidelity (same static scan Q0.5 established)", () => {
  const files = fs.readdirSync(FIDELITY_RUNTIME_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const contents = fs.readFileSync(path.join(FIDELITY_RUNTIME_DIR, file), "utf8");
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      assert.ok(!pattern.test(contents), `${file} must never use ${label}`);
    }
  }
});

test("D1_OHLC: three independent runs of the same bars/config produce an identical resultHash", () => {
  const config = buildFixtureAD1Config();
  const a = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  const b = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  const c = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  assert.equal(a.resultHash, b.resultHash);
  assert.equal(b.resultHash, c.resultHash);
});

test("D2_LOWER_TIMEFRAME: three independent runs of the same bars/config/detailProvider produce an identical resultHash", () => {
  const config = buildFixtureAD2Config();
  const a = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  const b = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  const c = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  assert.equal(a.resultHash, b.resultHash);
  assert.equal(b.resultHash, c.resultHash);
});

test("Replay: a second, fully independent call with a JSON-round-tripped copy of the bars reproduces the identical resultHash", () => {
  const config = buildFixtureAD2Config();
  const original = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  const roundTripped = JSON.parse(JSON.stringify(FIXTURE_A_PARENT_BARS));
  const replayed = runMultiFidelitySimulation(roundTripped, config);
  assert.equal(original.resultHash, replayed.resultHash);
});

test("Immutability: the input bars array is never mutated by a D2 run", () => {
  const config = buildFixtureAD2Config();
  const frozenBars = Object.freeze(FIXTURE_A_PARENT_BARS.map((b) => Object.freeze({ ...b })));
  assert.doesNotThrow(() => runMultiFidelitySimulation(frozenBars, config));
});

test("Immutability: every SimulationTrade in a D2 result's ledger is frozen (mutation attempts throw)", () => {
  const config = buildFixtureAD2Config();
  const result = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  assert.ok(result.tradeLedger.length > 0);
  assert.throws(() => {
    (result.tradeLedger[0] as { grossPnl: number }).grossPnl = 999999;
  }, TypeError);
});
