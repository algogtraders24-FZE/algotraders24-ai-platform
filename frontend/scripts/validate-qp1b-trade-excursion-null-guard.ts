// scripts/validate-qp1b-trade-excursion-null-guard.ts
// QP-1B - Production Render Blocker Fix. Proves the real root cause and its
// fix for the live-confirmed crash:
//   TypeError: Cannot read properties of undefined (reading 'toFixed')
// Reproduced live against production (run cmtk8n45m000104kz1461rd01):
// GET /api/private/algo-test/runs/cmtk8n45m000104kz1461rd01 returned a
// trade with `rMultiple` present but NO `mfeR`/`maeR` keys at all - genuinely
// `undefined`, not `null` - because that run predates the P4.6-T2.1 MFE/MAE
// feature and old rows are never backfilled. types/algo-test.ts types these
// fields `number | null` and its own doc comment claims "never undefined",
// but that claim does not hold for a pre-feature persisted row.
//
// No DOM renderer exists in this repo (same constraint every prior
// validator in this program documents) and the guard is a small inline
// JSX ternary, not an extracted function - so this validator (a) checks the
// real source text contains the fixed guard, verbatim, and (b) evaluates the
// exact same guard expression standalone against the real data shapes
// (including the literal shape captured live from production) to prove it
// no longer throws and still renders the documented "—" placeholder for a
// genuine `null`.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void): Promise<void> {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

// The exact fixed expression from AlgoTestPanel.tsx (checked byte-for-byte
// against the real source below - this is not a re-implementation, it is
// verified to match).
function fixedGuard(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)}R`;
}

// The exact PRE-fix expression - kept here only to prove it really does
// throw on the real production shape, so the regression this validator
// guards against is never mistaken for a hypothetical.
function preFixGuard(value: number | null | undefined): string {
  return value === null ? "—" : `${(value as number).toFixed(2)}R`;
}

async function main(): Promise<void> {
  console.log("\n=== A - the fixed guard's real behavior ===");

  await test("THE BUG, reproduced directly: a genuinely-undefined value (the real production shape - key absent from a pre-P4.6-T2.1 run's persisted trade) throws with the PRE-fix guard", () => {
    assert.throws(() => preFixGuard(undefined), /Cannot read propert(y|ies) of undefined/);
  });

  await test("THE FIX, proven directly: the same undefined value renders '—' with the fixed guard - no throw", () => {
    assert.equal(fixedGuard(undefined), "—");
  });

  await test("a genuine engine-computed null (the documented, pre-existing case) still renders '—' - unchanged behavior", () => {
    assert.equal(fixedGuard(null), "—");
  });

  await test("a real numeric value still renders normally - unchanged happy path", () => {
    assert.equal(fixedGuard(-1), "-1.00R");
    assert.equal(fixedGuard(1.5), "1.50R");
  });

  console.log("\n=== B - AlgoTestPanel.tsx structural checks (the real source contains the fix, all three fields) ===");

  const url = new URL("../components/chart-engine/AlgoTestPanel.tsx", import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) throw new Error("AlgoTestPanel.tsx does not exist");
  const PANEL = readFileSync(path, "utf8");

  await test("rMultiple's guard checks both null and undefined", () => {
    assert.ok(/trade\.rMultiple === null \|\| trade\.rMultiple === undefined \? "—" : `\$\{trade\.rMultiple\.toFixed\(2\)\}R`/.test(PANEL));
  });

  await test("mfeR's guard checks both null and undefined - this is the exact field the live crash's minified stack decoded to", () => {
    assert.ok(/trade\.mfeR === null \|\| trade\.mfeR === undefined \? "—" : `\$\{trade\.mfeR\.toFixed\(2\)\}R`/.test(PANEL));
  });

  await test("maeR's guard checks both null and undefined - same defect class, same fix, fixed alongside its sibling", () => {
    assert.ok(/trade\.maeR === null \|\| trade\.maeR === undefined \? "—" : `\$\{trade\.maeR\.toFixed\(2\)\}R`/.test(PANEL));
  });

  await test("no lingering `=== null ?` guard remains on any of the three fields without the companion `=== undefined` check", () => {
    for (const field of ["rMultiple", "mfeR", "maeR"]) {
      // Every occurrence of "trade.X === null" must be immediately followed
      // by "|| trade.X === undefined" - a bare, unfixed occurrence would
      // mean this specific field was missed.
      for (const m of PANEL.matchAll(new RegExp(`trade\\.${field} === null(?! \\|\\| trade\\.${field} === undefined)`, "g"))) {
        assert.fail(`found an unfixed 'trade.${field} === null' without the companion undefined check near index ${m.index}`);
      }
    }
  });

  await test("this fix touches only the excursion/R-multiple cells - the row's other cells (entry/exit price, pnl, timestamps) are untouched", () => {
    assert.ok(/formatPrice\(trade\.exitPrice, \{ maxDecimals: 5 \}\)/.test(PANEL));
    assert.ok(/formatPrice\(trade\.pnl, \{ maxDecimals: 2 \}\)/.test(PANEL));
  });

  await test("QP-1's own registry-symbol-mismatch gate (computeRegistrySymbolBlocked) is untouched by this fix - different defect, different function", () => {
    assert.ok(/export function computeRegistrySymbolBlocked/.test(PANEL));
    assert.ok(/&&\s*!run/.test(PANEL));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
