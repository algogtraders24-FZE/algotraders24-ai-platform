// scripts/validate-scheduler-wiring.ts
// Sprint D2.7.10 - Historical Validation Automatic Scheduler.
//
// D2.7.9's own regression suite (scripts/validate-outcome-evaluation-
// wiring.ts, scripts/validate-hypothesis-outcome.ts) already covers the
// evaluator's idempotency/concurrency/user-isolation contract exhaustively
// and is unchanged by this sprint - not re-tested here (see this project's
// own instructions: "Existing D2.7.9 tests must remain green," run as
// regression, not duplicated). This script covers only what D2.7.10 added:
// vercel.json configuration, the cron-secret auth logic (now extracted and
// directly testable), the GET/POST route wiring, and that the cron path
// cannot be handed an arbitrary batch scope.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidCronSecret } from "../lib/intelligence/cron-auth";
import { loadIntelligenceEvaluationCronSecret } from "../lib/intelligence/evaluation-env";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

const ROOT = join(__dirname, "..");

async function main(): Promise<void> {
  // ==== Configuration: vercel.json ====
  await test("config: vercel.json exists and is valid JSON", () => {
    const content = readFileSync(join(ROOT, "vercel.json"), "utf-8");
    const parsed = JSON.parse(content);
    assert.ok(Array.isArray(parsed.crons), "must have a crons array");
  });

  await test("config: exactly one cron entry targets the existing evaluation route", () => {
    const parsed = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf-8"));
    const matching = parsed.crons.filter((c: { path: string }) => c.path === "/api/private/admin/intelligence/evaluate-outcomes");
    assert.equal(matching.length, 1, "must target the existing D2.7.9 route exactly once - no duplicate cron entries for the same route");
  });

  await test("config: schedule is once-daily (Hobby-plan compatible), not more frequent", () => {
    const parsed = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf-8"));
    const entry = parsed.crons.find((c: { path: string }) => c.path === "/api/private/admin/intelligence/evaluate-outcomes");
    assert.equal(entry.schedule, "0 2 * * *", "must be the recommended fixed daily schedule - a single-value minute+hour, wildcard day/month/weekday");
    const fields: string[] = entry.schedule.split(" ");
    assert.equal(fields.length, 5, "must be a 5-field cron expression");
    assert.ok(!fields[0].includes("/") && !fields[0].includes("*"), "minute field must be a fixed value, never */N or * (which would run more than once a day)");
    assert.ok(!fields[1].includes("/") && !fields[1].includes("*"), "hour field must be a fixed value, never */N or * (which would run more than once a day)");
    assert.equal(fields[2], "*", "day-of-month must be wildcard for a daily schedule");
    assert.equal(fields[3], "*", "month must be wildcard for a daily schedule");
    assert.equal(fields[4], "*", "day-of-week must be wildcard for a daily schedule");
  });

  await test("config: no unrelated vercel.json configuration was clobbered (file contains only $schema and crons - none existed before this sprint)", () => {
    const parsed = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf-8"));
    const keys = Object.keys(parsed).sort();
    assert.deepEqual(keys, ["$schema", "crons"], "no vercel.json existed before D2.7.10, so nothing could have been overwritten - this asserts the file stayed minimal");
  });

  // ==== Route: GET + POST wiring ====
  await test("structural: the route exports both GET and POST, sharing one handler (Vercel Cron requires GET; the D2.7.9 admin/manual path used POST)", () => {
    const routePath = join(ROOT, "app", "api", "private", "admin", "intelligence", "evaluate-outcomes", "route.ts");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(/export const GET = withContext\(handleEvaluationTrigger\)/.test(content), "GET must exist and use the shared handler");
    assert.ok(/export const POST = withContext\(handleEvaluationTrigger\)/.test(content), "POST must still exist (preserves any existing non-Vercel caller) and use the exact same shared handler - not a second implementation");
  });

  await test("structural: maxDuration is configured (Hobby's own fluid-compute ceiling)", () => {
    const routePath = join(ROOT, "app", "api", "private", "admin", "intelligence", "evaluate-outcomes", "route.ts");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(/export const maxDuration = 300/.test(content));
  });

  await test("structural: the route still gates non-cron requests on requireAdmin, matching every other /api/private/admin/* route", () => {
    const routePath = join(ROOT, "app", "api", "private", "admin", "intelligence", "evaluate-outcomes", "route.ts");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(content.includes("requireAdmin"), "admin gate must still exist");
  });

  await test("structural: the cron-authenticated branch never reads maxUsers/perUserLimit/userId from the request - it is fixed and deterministic", () => {
    const routePath = join(ROOT, "app", "api", "private", "admin", "intelligence", "evaluate-outcomes", "route.ts");
    const content = readFileSync(routePath, "utf-8");
    const cronBlockMatch = content.match(/if \(isValidCronSecret\(req\)\) \{([\s\S]*?)\n\s*\}/);
    assert.ok(cronBlockMatch, "must find the cron-secret branch");
    const block = cronBlockMatch![1];
    assert.ok(!block.includes("searchParams"), "the cron branch must not read any query parameter at all - fixed DEFAULT_MAX_USERS/DEFAULT_PER_USER_LIMIT only");
    assert.ok(block.includes("DEFAULT_MAX_USERS") && block.includes("DEFAULT_PER_USER_LIMIT"), "must use the fixed production defaults");
  });

  await test("structural: only one evaluation implementation is reachable - both GET and POST resolve to the same D2.7.9 orchestration service, never a second evaluator", () => {
    const routePath = join(ROOT, "app", "api", "private", "admin", "intelligence", "evaluate-outcomes", "route.ts");
    const content = readFileSync(routePath, "utf-8");
    const importCount = (content.match(/from "@\/services\/intelligence\/orchestration\/scheduled-outcome-evaluation\.service"/g) || []).length;
    assert.equal(importCount, 1);
    assert.ok(!content.includes("new HypothesisOutcomeEvaluatorService"), "route must never construct its own evaluator");
  });

  // ==== Security: cron secret verification (live, real function - no Next.js request-scope dependency) ====
  await test("security: request rejected when no cron secret is configured at all (both env vars unset)", () => {
    withEnv({ INTELLIGENCE_EVALUATION_CRON_SECRET: undefined, CRON_SECRET: undefined }, () => {
      const req = new Request("https://example.com/api/private/admin/intelligence/evaluate-outcomes", {
        headers: { authorization: "Bearer anything" },
      });
      assert.equal(isValidCronSecret(req), false, "must never treat an unconfigured secret as \"accept anyone\"");
    });
  });

  await test("security: request rejected when the Authorization header is missing entirely", () => {
    withEnv({ INTELLIGENCE_EVALUATION_CRON_SECRET: "real-secret-value-123", CRON_SECRET: undefined }, () => {
      const req = new Request("https://example.com/api/private/admin/intelligence/evaluate-outcomes");
      assert.equal(isValidCronSecret(req), false);
    });
  });

  await test("security: request rejected when the presented secret is wrong", () => {
    withEnv({ INTELLIGENCE_EVALUATION_CRON_SECRET: "real-secret-value-123", CRON_SECRET: undefined }, () => {
      const req = new Request("https://example.com/api/private/admin/intelligence/evaluate-outcomes", {
        headers: { authorization: "Bearer wrong-secret" },
      });
      assert.equal(isValidCronSecret(req), false);
    });
  });

  await test("security: request rejected when the header lacks the Bearer prefix", () => {
    withEnv({ INTELLIGENCE_EVALUATION_CRON_SECRET: "real-secret-value-123", CRON_SECRET: undefined }, () => {
      const req = new Request("https://example.com/api/private/admin/intelligence/evaluate-outcomes", {
        headers: { authorization: "real-secret-value-123" },
      });
      assert.equal(isValidCronSecret(req), false);
    });
  });

  await test("security: valid INTELLIGENCE_EVALUATION_CRON_SECRET (the original D2.7.9 name) is accepted", () => {
    withEnv({ INTELLIGENCE_EVALUATION_CRON_SECRET: "real-secret-value-123", CRON_SECRET: undefined }, () => {
      const req = new Request("https://example.com/api/private/admin/intelligence/evaluate-outcomes", {
        headers: { authorization: "Bearer real-secret-value-123" },
      });
      assert.equal(isValidCronSecret(req), true);
    });
  });

  await test("security: Vercel's native CRON_SECRET convention is accepted when INTELLIGENCE_EVALUATION_CRON_SECRET is unset (D2.7.10's fallback)", () => {
    withEnv({ INTELLIGENCE_EVALUATION_CRON_SECRET: undefined, CRON_SECRET: "vercel-native-secret-456" }, () => {
      const req = new Request("https://example.com/api/private/admin/intelligence/evaluate-outcomes", {
        headers: { authorization: "Bearer vercel-native-secret-456" },
      });
      assert.equal(isValidCronSecret(req), true);
    });
  });

  await test("security: when both env vars are set, INTELLIGENCE_EVALUATION_CRON_SECRET takes priority over CRON_SECRET", () => {
    withEnv({ INTELLIGENCE_EVALUATION_CRON_SECRET: "primary-secret", CRON_SECRET: "fallback-secret" }, () => {
      assert.equal(loadIntelligenceEvaluationCronSecret(), "primary-secret");
      const reqWithFallback = new Request("https://example.com/api", { headers: { authorization: "Bearer fallback-secret" } });
      assert.equal(isValidCronSecret(reqWithFallback), false, "the fallback value alone must not authenticate once the primary is configured to something else");
      const reqWithPrimary = new Request("https://example.com/api", { headers: { authorization: "Bearer primary-secret" } });
      assert.equal(isValidCronSecret(reqWithPrimary), true);
    });
  });

  await test("security: constant-time comparison is used, not a plain string equality", () => {
    const cronAuthPath = join(ROOT, "lib", "intelligence", "cron-auth.ts");
    const content = readFileSync(cronAuthPath, "utf-8");
    assert.ok(content.includes("timingSafeEqual"));
  });

  await test("security: no hardcoded/committed secret literal in the cron-auth or env module", () => {
    const cronAuthPath = join(ROOT, "lib", "intelligence", "cron-auth.ts");
    const envPath = join(ROOT, "lib", "intelligence", "evaluation-env.ts");
    for (const path of [cronAuthPath, envPath]) {
      const content = readFileSync(path, "utf-8");
      assert.ok(!/=\s*["'][A-Za-z0-9+/]{16,}["']/.test(content), `${path} must never assign a literal secret-looking string`);
    }
  });

  // ==== .env.example documents both names, no real values ====
  await test("config: .env.example documents INTELLIGENCE_EVALUATION_CRON_SECRET and the CRON_SECRET fallback, both blank", () => {
    const content = readFileSync(join(ROOT, ".env.example"), "utf-8");
    assert.ok(/^INTELLIGENCE_EVALUATION_CRON_SECRET=\s*$/m.test(content));
    assert.ok(/^CRON_SECRET=\s*$/m.test(content));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
