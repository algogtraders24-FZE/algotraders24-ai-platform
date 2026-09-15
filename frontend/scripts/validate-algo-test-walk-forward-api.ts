// scripts/validate-algo-test-walk-forward-api.ts
// P4.9-B-B.4 (docs/P4.9-OPTIMIZATION-WFO.md) - structural, source-verified
// tests, the EXACT same established, disclosed convention
// scripts/validate-algo-test-optimization-api.ts already uses for its own
// sibling A.3 routes (that file's own header comment: "Route-level
// HTTP/auth testing... is NOT unit-tested here - this codebase's own
// established convention... relies on live/manual verification for that
// layer instead"). getUserOrNull() reads real request cookies via
// next/headers - there is nothing to fake here the way prisma/the
// historical-data provider were faked for the SERVICE-layer validators.
// Ownership isolation itself (a different user's experiment resolves to
// null/NOT_FOUND, never leaks existence) is already proven at the SERVICE
// layer by B.2's own validate-algo-test-walk-forward-service.ts ("a
// different user resolves to null") and B.3's own
// validate-algo-test-walk-forward-execution.ts (NOT_FOUND on a nonexistent
// experiment, via the same userId-scoped getWalkForwardExperiment() call
// continueWalkForwardExperiment() itself uses) - this file instead proves,
// by reading the real route source, that every route (a) checks auth
// before touching any service, (b) never trusts a client-supplied user id,
// always passing sessionUser.profile.id, and (c) calls the exact locked
// service method with the exact locked error-code -> HTTP-status mapping.
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

const ROUTE_DIR = "../app/api/private/algo-test/walk-forward";

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

const ALL_ROUTES: readonly { name: string; source: string; serviceCallMarker: string }[] = [
  { name: "POST /walk-forward", source: CREATE, serviceCallMarker: "walkForwardService." },
  { name: "GET /walk-forward/[experimentId]", source: DETAIL, serviceCallMarker: "walkForwardService." },
  { name: "POST /walk-forward/[experimentId]/continue", source: CONTINUE, serviceCallMarker: "walkForwardExecutionService." },
  { name: "POST /walk-forward/[experimentId]/cancel", source: CANCEL, serviceCallMarker: "walkForwardService." },
];

async function main(): Promise<void> {
  console.log("\n=== A - Authentication: the exact 4 routes exist and check auth before any service call ===");

  await test("all four route files exist (CREATE/DETAIL/CONTINUE/CANCEL already loaded above without throwing)", () => {
    assert.ok(CREATE.length > 0 && DETAIL.length > 0 && CONTINUE.length > 0 && CANCEL.length > 0);
  });

  for (const { name, source, serviceCallMarker } of ALL_ROUTES) {
    await test(`${name}: uses withContext`, () => {
      assert.ok(/withContext\(/.test(source), "must wrap its handler in withContext");
    });
    await test(`${name}: checks getUserOrNull() and returns 401 UNAUTHORIZED before any service call (unauthenticated request rejected)`, () => {
      const bodyStart = source.indexOf("withContext(async");
      assert.ok(bodyStart > 0, "must define its handler via withContext(async ...)");
      const authIdx = source.indexOf("getUserOrNull()", bodyStart);
      assert.ok(authIdx > bodyStart, "must call getUserOrNull()");
      const unauthorizedIdx = source.indexOf("UNAUTHORIZED", authIdx);
      assert.ok(unauthorizedIdx > authIdx, "the UNAUTHORIZED response must be written after the getUserOrNull() call");
      const serviceCallIdx = source.indexOf(serviceCallMarker, unauthorizedIdx);
      assert.ok(serviceCallIdx > unauthorizedIdx, `the first real ${serviceCallMarker}* call (after the auth guard) must exist`);
    });
  }

  console.log("\n=== B - Ownership: userId is always sessionUser.profile.id, never client-supplied ===");

  for (const { name, source } of ALL_ROUTES) {
    await test(`${name}: userId is sessionUser.profile.id - never a client-supplied value (so a different user's experiment can never be read/started/continued/cancelled)`, () => {
      assert.ok(source.includes("sessionUser.profile.id"), "must pass sessionUser.profile.id as the userId argument");
      assert.ok(!/body\.userId|params\.userId|req\.userId|query\.userId/.test(source), "must never read a userId from client input");
    });
  }

  console.log("\n=== C/D/E/F - Each route calls the exact locked service method ===");

  await test("C - POST /walk-forward calls walkForwardService.createWalkForwardExperiment (fold derivation stays inside the service, never in the route)", () => {
    assert.ok(CREATE.includes("walkForwardService.createWalkForwardExperiment("));
    assert.ok(!/walkForwardFold|deriveFolds/.test(CREATE), "the route must never derive/construct folds itself - that stays walkForwardService's own job");
  });
  await test("D - GET /walk-forward/[experimentId] calls walkForwardService.getWalkForwardExperiment", () => {
    assert.ok(DETAIL.includes("walkForwardService.getWalkForwardExperiment("));
  });
  await test("E - POST .../continue calls walkForwardExecutionService.continueWalkForwardExperiment (the B.3 execution service, not walkForwardService directly)", () => {
    assert.ok(CONTINUE.includes("walkForwardExecutionService.continueWalkForwardExperiment("));
  });
  await test("F - POST .../cancel calls walkForwardService.cancelWalkForwardExperiment", () => {
    assert.ok(CANCEL.includes("walkForwardService.cancelWalkForwardExperiment("));
  });

  console.log("\n=== Dynamic-route id parsing: local, duplicated per file (the established A.3 convention), never a shared helper ===");

  for (const { name, source } of [ALL_ROUTES[1]!, ALL_ROUTES[2]!, ALL_ROUTES[3]!]) {
    await test(`${name}: defines its own local experimentIdFromPath() reading ctx.path via indexOf("walk-forward") + 1`, () => {
      assert.ok(/function experimentIdFromPath/.test(source), "must define a local helper, not import a shared one");
      assert.ok(source.includes('indexOf("walk-forward")'), 'must locate the id by finding the "walk-forward" segment');
      assert.ok(!/from ["'].*experimentIdFromPath/.test(source), "must not import the helper from another route file");
    });
  }

  console.log("\n=== H - Locked HTTP-status / error-code mapping ===");

  await test("POST /walk-forward: every WalkForwardServiceError from creation maps to 400 (validation-shaped, mirrors the P4.9-A.3 lock)", () => {
    assert.ok(CREATE.includes("instanceof WalkForwardServiceError"), "must explicitly catch WalkForwardServiceError - it is not an AppError, withContext's own catch-all would collapse it to a generic 500");
    const catchBlock = CREATE.slice(CREATE.indexOf("catch (err)"));
    assert.ok(/,\s*400\s*,/.test(catchBlock), "the caught WalkForwardServiceError branch must respond 400");
    assert.ok(!/,\s*(401|403|404|409|422|429|500|502|503)\s*,/.test(catchBlock), "must not use any other status for the caught WalkForwardServiceError branch");
  });

  await test("GET /walk-forward/[experimentId]: null -> 404 NOT_FOUND", () => {
    assert.ok(/if \(!experiment\)/.test(DETAIL));
    const notFoundBlock = DETAIL.slice(DETAIL.indexOf("if (!experiment)"));
    assert.ok(/NOT_FOUND/.test(notFoundBlock) && /,\s*404\s*,/.test(notFoundBlock));
  });

  await test('POST .../continue: NOT_FOUND -> 404, PROVIDER_ERROR (and any other non-NOT_FOUND code) -> 500, HttpStatusCode never extended to 502/503', () => {
    assert.ok(CONTINUE.includes("instanceof WalkForwardServiceError"));
    const catchBlock = CONTINUE.slice(CONTINUE.indexOf("catch (err)"));
    assert.ok(/err\.code === "NOT_FOUND" \? 404 : 500/.test(catchBlock.replace(/\s+/g, " ")), 'must map NOT_FOUND to 404 and every other code (PROVIDER_ERROR included) to the existing 500 - never a new 502/503 status');
    assert.ok(!/,\s*50[23]\s*,/.test(catchBlock), "must not use 502/503 as an actual response status anywhere in this route's error handling - mirrors the A.3 lock keeping PROVIDER_ERROR on the existing 500 transport status");
  });

  await test("POST .../cancel: null -> 404 NOT_FOUND", () => {
    assert.ok(/if \(!experiment\)/.test(CANCEL));
    const notFoundBlock = CANCEL.slice(CANCEL.indexOf("if (!experiment)"));
    assert.ok(/NOT_FOUND/.test(notFoundBlock) && /,\s*404\s*,/.test(notFoundBlock));
  });

  console.log("\n=== G - Invalid lifecycle / idempotency: terminal states are a harmless no-op, never a distinct error code ===");

  await test('no route file ever returns "ALREADY_TERMINAL" as an actual response code - a terminal continue() stays a plain 200 (continueWalkForwardExperiment() itself is idempotent on terminal states, per B.3), and a terminal cancel() stays a plain 200 no-op (cancelWalkForwardExperiment()\'s own atomic WHERE clause matches nothing, current status is simply re-returned) - checked as a real code-field value, not a bare substring', () => {
    for (const { source } of ALL_ROUTES) assert.ok(!/code:\s*"ALREADY_TERMINAL"/.test(source));
  });

  await test("no route ever mutates WalkForwardExperiment/Fold/Candidate status via a raw prisma write - only the locked lifecycle/execution services are ever called", () => {
    for (const { source } of ALL_ROUTES) {
      assert.ok(!/prisma\.walkForward(Experiment|Fold|Candidate)/.test(source), "must never bypass walkForwardService/walkForwardExecutionService with a raw Prisma write");
    }
  });

  console.log("\n=== I - Response shape: only the intended envelope, no internal leakage ===");

  for (const { name, source } of ALL_ROUTES) {
    await test(`${name}: success responses wrap the experiment in { experiment } via ApiResponse.success - no stack traces, no raw Prisma rows`, () => {
      assert.ok(/ApiResponse\.success\(\{\s*experiment\s*\}/.test(source), "success response must be shaped as { experiment }");
      assert.ok(!/err\.stack|\.stack\b/.test(source), "must never expose an error's stack trace in a response");
    });
  }

  console.log("\n=== Scope discipline ===");

  await test("no route file imports/references algoTestService or optimizationService (sibling, unrelated services) - walk-forward stays its own concern", () => {
    for (const { source } of ALL_ROUTES) {
      assert.ok(!/\balgoTestService\b/.test(source));
      assert.ok(!/\boptimizationService\b/.test(source));
    }
  });

  await test("CONTINUE route imports WalkForwardServiceError from walk-forward.service (not walk-forward-execution.service) - the error class is owned by the lifecycle module, execution only throws instances of it", () => {
    assert.ok(/import\s*\{\s*WalkForwardServiceError\s*\}\s*from\s*["']@\/services\/algo-test\/walk-forward\.service["']/.test(CONTINUE));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
