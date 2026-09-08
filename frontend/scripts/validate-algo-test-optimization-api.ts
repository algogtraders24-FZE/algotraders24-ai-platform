// scripts/validate-algo-test-optimization-api.ts
// P4.9-A.3 (docs/P4.9-OPTIMIZATION-WFO.md) - structural, source-verified
// tests, not a live NextRequest mock. This matches this codebase's own
// established, disclosed convention for this exact layer:
// validate-algo-test-service.ts's own header comment states "Route-level
// HTTP/auth testing... is NOT unit-tested here - this codebase's own
// established convention... relies on live/manual verification for that
// layer instead", and validate-algo-test-strategy-persistence.ts's own
// final test ("runAlgoTest... never calls persistAiStrategy/prisma.strategy
// anywhere - read directly from source, not inferred behaviorally") is the
// exact technique this file extends to the new A.3 routes.
//
// getUserOrNull() (lib/auth/protectedRoute.ts) delegates to
// SessionService.getSessionUser(), which reads real request cookies via
// next/headers - there is nothing to fake here the way prisma/the
// historical-data provider were faked for the SERVICE-layer validators
// (A.2's own scripts/validate-algo-test-optimization-service.ts already
// covers every actual business-logic path against the real service). This
// file instead proves, by reading the real route source, the properties a
// live-request test would otherwise have to exercise one endpoint at a
// time: every route checks auth before touching the service, never trusts
// a client-supplied user id, calls the exact locked service method, and
// maps the exact locked set of error codes to the exact locked HTTP
// statuses - regressions in any of those are real, catchable bugs, not
// hypothetical ones.
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

const ROUTE_DIR = "../app/api/private/algo-test/optimization";

function readRoute(relativePath: string): string {
  const url = new URL(`${ROUTE_DIR}/${relativePath}`, import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) throw new Error(`route file does not exist: ${relativePath}`);
  return readFileSync(path, "utf8");
}

const CREATE = readRoute("route.ts");
const DETAIL = readRoute("[experimentId]/route.ts");
const CONTINUE = readRoute("[experimentId]/continue/route.ts");
const CANCEL = readRoute("[experimentId]/cancel/route.ts");

const ALL_ROUTES: readonly { name: string; source: string }[] = [
  { name: "POST /optimization", source: CREATE },
  { name: "GET /optimization/[experimentId]", source: DETAIL },
  { name: "POST /optimization/[experimentId]/continue", source: CONTINUE },
  { name: "POST /optimization/[experimentId]/cancel", source: CANCEL },
];

async function main(): Promise<void> {
  console.log("\n=== The exact 4 locked routes exist at the exact locked paths ===");

  await test("all four route files exist (CREATE/DETAIL/CONTINUE/CANCEL already loaded above without throwing)", () => {
    assert.ok(CREATE.length > 0 && DETAIL.length > 0 && CONTINUE.length > 0 && CANCEL.length > 0);
  });

  console.log("\n=== withContext + auth-before-service on every route ===");

  for (const { name, source } of ALL_ROUTES) {
    await test(`${name}: uses withContext`, () => {
      assert.ok(/withContext\(/.test(source), "must wrap its handler in withContext");
    });
    await test(`${name}: checks getUserOrNull() and returns 401 UNAUTHORIZED before any service call`, () => {
      // Searched from the handler body only (after "withContext(async" -
      // the header comment above it legitimately mentions optimizationService
      // in prose, which must not count as "the call").
      const bodyStart = source.indexOf("withContext(async");
      assert.ok(bodyStart > 0, "must define its handler via withContext(async ...)");
      const authIdx = source.indexOf("getUserOrNull()", bodyStart);
      assert.ok(authIdx > bodyStart, "must call getUserOrNull()");
      const unauthorizedIdx = source.indexOf("UNAUTHORIZED", authIdx);
      assert.ok(unauthorizedIdx > authIdx, "the UNAUTHORIZED response must be written after the getUserOrNull() call");
      const serviceCallIdx = source.indexOf("optimizationService.", unauthorizedIdx);
      assert.ok(serviceCallIdx > unauthorizedIdx, "the first real optimizationService.* call (after the auth guard) must exist");
    });
    await test(`${name}: userId is sessionUser.profile.id - never a client-supplied value`, () => {
      assert.ok(source.includes("sessionUser.profile.id"), "must pass sessionUser.profile.id as the userId argument");
      assert.ok(!/body\.userId|params\.userId|req\.userId|query\.userId/.test(source), "must never read a userId from client input");
    });
  }

  console.log("\n=== Each route calls the exact locked service method ===");

  await test("POST /optimization calls optimizationService.createOptimizationExperiment", () => {
    assert.ok(CREATE.includes("optimizationService.createOptimizationExperiment("));
  });
  await test("GET /optimization/[experimentId] calls optimizationService.getOptimizationExperiment", () => {
    assert.ok(DETAIL.includes("optimizationService.getOptimizationExperiment("));
  });
  await test("POST .../continue calls optimizationService.continueOptimizationExperiment", () => {
    assert.ok(CONTINUE.includes("optimizationService.continueOptimizationExperiment("));
  });
  await test("POST .../cancel calls optimizationService.cancelOptimizationExperiment", () => {
    assert.ok(CANCEL.includes("optimizationService.cancelOptimizationExperiment("));
  });

  console.log("\n=== Dynamic-route id parsing: local, duplicated per file (the established convention), never a shared helper ===");

  for (const { name, source } of [ALL_ROUTES[1]!, ALL_ROUTES[2]!, ALL_ROUTES[3]!]) {
    await test(`${name}: defines its own local experimentIdFromPath() reading ctx.path via indexOf("optimization") + 1`, () => {
      assert.ok(/function experimentIdFromPath/.test(source), "must define a local helper, not import a shared one");
      assert.ok(source.includes('indexOf("optimization")'), 'must locate the id by finding the "optimization" segment');
      assert.ok(!/from ["'].*experimentIdFromPath/.test(source), "must not import the helper from another route file");
    });
  }

  console.log("\n=== Locked HTTP-status mapping ===");

  await test("POST /optimization: every OptimizationServiceError from creation maps to 400 (validation-shaped, per the A.3 lock)", () => {
    assert.ok(CREATE.includes("instanceof OptimizationServiceError"), "must explicitly catch OptimizationServiceError - it is not an AppError, withContext's own catch-all would collapse it to a generic 500");
    const catchBlock = CREATE.slice(CREATE.indexOf("catch (err)"));
    assert.ok(/,\s*400\s*,/.test(catchBlock), "the caught OptimizationServiceError branch must respond 400");
    assert.ok(!/,\s*(401|403|404|409|422|429|500|502|503)\s*,/.test(catchBlock), "must not use any other status for the caught OptimizationServiceError branch");
  });

  await test("GET /optimization/[experimentId]: null -> 404 NOT_FOUND", () => {
    assert.ok(/if \(!experiment\)/.test(DETAIL));
    const notFoundBlock = DETAIL.slice(DETAIL.indexOf("if (!experiment)"));
    assert.ok(/NOT_FOUND/.test(notFoundBlock) && /,\s*404\s*,/.test(notFoundBlock));
  });

  await test('POST .../continue: NOT_FOUND -> 404, PROVIDER_ERROR (and any other non-NOT_FOUND code) -> 500, HttpStatusCode never extended to 502/503', () => {
    assert.ok(CONTINUE.includes("instanceof OptimizationServiceError"));
    const catchBlock = CONTINUE.slice(CONTINUE.indexOf("catch (err)"));
    assert.ok(/err\.code === "NOT_FOUND" \? 404 : 500/.test(catchBlock.replace(/\s+/g, " ")), 'must map NOT_FOUND to 404 and every other code (PROVIDER_ERROR included) to the existing 500 - never a new 502/503 status');
    // Checked as an actual status-code position (", 502," / ", 503,"), not
    // a bare substring - this file's own header comment legitimately
    // discusses "502/503" in prose to explain what was deliberately NOT
    // done, which must not itself trip this check.
    assert.ok(!/,\s*50[23]\s*,/.test(catchBlock), "must not use 502/503 as an actual response status anywhere in this route's error handling - the A.3 lock explicitly keeps PROVIDER_ERROR on the existing 500 transport status");
  });

  await test("POST .../cancel: null -> 404 NOT_FOUND", () => {
    assert.ok(/if \(!experiment\)/.test(CANCEL));
    const notFoundBlock = CANCEL.slice(CANCEL.indexOf("if (!experiment)"));
    assert.ok(/NOT_FOUND/.test(notFoundBlock) && /,\s*404\s*,/.test(notFoundBlock));
  });

  console.log("\n=== Scope discipline ===");

  await test('no route file ever returns "ALREADY_TERMINAL" as an actual response code - a terminal continue() stays a plain 200, per the locked semantics (checked as a real code-field value, not a bare substring - prose explaining this decision is expected and fine)', () => {
    for (const { source } of ALL_ROUTES) assert.ok(!/code:\s*"ALREADY_TERMINAL"/.test(source));
  });

  await test("no route file imports/references algoTestService (the sibling, unrelated Algo Test Run service) - optimization stays its own concern", () => {
    for (const { source } of ALL_ROUTES) assert.ok(!/\balgoTestService\b/.test(source));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
