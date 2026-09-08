// scripts/validate-agent-parallel.mjs
// Sprint AN, step A14. Proves the validation harnesses are isolation-safe
// under real concurrency: several DB-writing agent-framework suites (plus a
// duplicate of the hardening suite) run AT THE SAME TIME against the shared
// dev DB. Each suite writes real A3 rows under a per-process synthetic user
// and cleans them up by user; if any suite deleted another's rows mid-run
// we'd see an AgentStep_runId_fkey failure or a wrong count.
//
// Run: npm run validate:agent-parallel
//
// Network-light suites only (no live market/intelligence/backtest calls) so
// the signal is DB contention, not provider rate limits.

import { spawn } from "node:child_process";

const SUITES = [
  "validate:agent-hardening",
  "validate:agent-hardening", // a second concurrent copy - the real collision test
  "validate:agent-runtime",
  "validate:agent-run-persistence",
  "validate:agent-integrity",
  "validate:agent-authorization",
  "validate:agent-credit",
  "validate:agent-evaluation",
  "validate:agent-memory",
];

function run(script, i) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("npm", ["run", script], { shell: true, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      const m = out.match(/(\d+) passed, (\d+) failed/);
      resolve({
        script: `${script}#${i}`,
        code,
        passed: m ? Number(m[1]) : null,
        failed: m ? Number(m[2]) : null,
        ms: Date.now() - started,
        tail: out.split("\n").filter((l) => /FAIL -|Error|fkey|constraint/i.test(l)).slice(0, 8),
      });
    });
  });
}

const results = await Promise.all(SUITES.map(run));

let ok = true;
console.log("\nparallel agent-framework regression\n");
for (const r of results) {
  const bad = r.code !== 0 || r.failed !== 0 || r.passed === null;
  if (bad) ok = false;
  console.log(
    `  ${bad ? "FAIL" : "ok  "}  ${r.script.padEnd(34)} ${String(r.passed ?? "?").padStart(3)} passed / ${r.failed ?? "?"} failed  (${(r.ms / 1000).toFixed(1)}s, exit ${r.code})`,
  );
  for (const line of r.tail) console.log(`         ${line.trim()}`);
}
console.log(`\n${ok ? "PASS" : "FAIL"} - ${results.length} suites run concurrently, ${results.filter((r) => r.code === 0 && r.failed === 0).length} clean`);
process.exit(ok ? 0 : 1);
