import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { GOLDEN_BARS, GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig } from "./fixtures/simulation-fixtures.js";

/**
 * Q0.5.36: run A / B / C — identical inputs must produce byte-for-byte
 * identical events, orders, fills, positions, account, ledger, metrics,
 * and provenance. Compared via resultHash plus a full deep-equal.
 */
test("Q0.5.36: three independent runs of the identical simulation produce identical results", () => {
  const runA = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const runB = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const runC = runSimulation(GOLDEN_BARS, buildGoldenConfig());

  assert.equal(runA.resultHash, runB.resultHash);
  assert.equal(runB.resultHash, runC.resultHash);
  assert.deepEqual(runA, runB);
  assert.deepEqual(runB, runC);
});

test("Q0.5.36: determinism holds for the more complex re-entry scenario too", () => {
  const a = runSimulation(GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig(GOLDEN_BARS_WITH_REENTRY));
  const b = runSimulation(GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig(GOLDEN_BARS_WITH_REENTRY));
  assert.equal(a.resultHash, b.resultHash);
});

test("Q0.5.36: freshly-constructed but structurally-identical bar arrays produce the identical result", () => {
  const bars1 = GOLDEN_BARS.map((b) => ({ ...b }));
  const bars2 = GOLDEN_BARS.map((b) => ({ ...b }));
  const a = runSimulation(bars1, buildGoldenConfig(bars1));
  const b = runSimulation(bars2, buildGoldenConfig(bars2));
  assert.equal(a.resultHash, b.resultHash);
});

test("Q0.5.36: no Date.now(), Math.random(), or environment-dependent source anywhere in the simulation runtime (static scan)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const simDir = join(here, "..", "src", "runtime", "simulation");
  const files = readdirSync(simDir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0);

  const forbidden = [/Date\.now\(\)/, /Math\.random\(\)/, /process\.env/, /new Date\(\)(?!\.)/, /crypto\.randomUUID/];
  for (const file of files) {
    const content = readFileSync(join(simDir, file), "utf-8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${file} must not use ${pattern} (wall-clock/random/env access is forbidden in the simulation runtime)`);
    }
  }
});
