// scripts/validate-developers-docs.ts
// The /developers page must say what the server really does. No database, no network.
//   npx tsx --conditions=react-server scripts/validate-developers-docs.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_TOOL_NAMES } from "../services/mcp/mcp-tool-map";
import { MCP_DAILY_LIMITS } from "../services/mcp/quota";
import { MCP_PLAN_GATED_TOOLS } from "../services/mcp/facade";
import { CLAUDE_CODE_COMMAND, GENERIC_MCP_CONFIG, JS_EXAMPLE, MCP_ENDPOINT, MCP_TOOL_DOCS, PUBLIC_RESULTS_ENDPOINT, PYTHON_EXAMPLE, SECURITY_NOTES, NOT_AVAILABLE } from "../lib/content/developers";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

const root = join(__dirname, "..");
const tokensRoute = readFileSync(join(root, "app/api/private/mcp/tokens/route.ts"), "utf8");

test("every real MCP tool is documented, and nothing else is", () => {
  assert.deepEqual([...MCP_TOOL_DOCS.map((t) => t.name)].sort(), [...MCP_TOOL_NAMES].sort());
});

test("documented daily limits equal the server's limits", () => {
  for (const t of MCP_TOOL_DOCS) assert.equal(t.dailyLimit, MCP_DAILY_LIMITS[t.name as keyof typeof MCP_DAILY_LIMITS], `limit for ${t.name}`);
});

test("the paid-plan tools on the page are exactly the plan-gated tools", () => {
  const documented = MCP_TOOL_DOCS.filter((t) => t.paid).map((t) => t.name).sort();
  assert.deepEqual(documented, [...MCP_PLAN_GATED_TOOLS].sort());
});

test("token rules on the page (90 days, 5 active) match the token route", () => {
  assert.match(tokensRoute, /MAX_ACTIVE_TOKENS\s*=\s*5\b/);
  assert.match(tokensRoute, /DEFAULT_EXPIRY_DAYS\s*=\s*90\b/);
  const text = SECURITY_NOTES.join(" ");
  assert.ok(/90 days/.test(text) && /up to 5 active/.test(text));
});

test("endpoints use the canonical www host (the bare domain redirects and drops Authorization)", () => {
  assert.ok(MCP_ENDPOINT.startsWith("https://www.algotraders24.ai/"));
  assert.ok(PUBLIC_RESULTS_ENDPOINT.startsWith("https://www.algotraders24.ai/"));
  assert.ok(CLAUDE_CODE_COMMAND.includes(MCP_ENDPOINT) && GENERIC_MCP_CONFIG.includes(MCP_ENDPOINT));
});

test("examples carry only placeholders: no real token shape anywhere", () => {
  const all = [CLAUDE_CODE_COMMAND, GENERIC_MCP_CONFIG, PYTHON_EXAMPLE, JS_EXAMPLE, ...SECURITY_NOTES, ...NOT_AVAILABLE].join("\n");
  assert.ok(!/at24_mcp_[A-Za-z0-9_-]{10,}/.test(all), "a real-looking token is present");
  assert.ok(CLAUDE_CODE_COMMAND.includes("YOUR_TOKEN") && GENERIC_MCP_CONFIG.includes("YOUR_TOKEN"));
});

test("the page promises no execution and no guarantee", () => {
  const all = [...SECURITY_NOTES, ...NOT_AVAILABLE].join(" ").toLowerCase();
  assert.ok(all.includes("read-only") && all.includes("no order placement"));
  assert.ok(all.includes("no uptime or service-level guarantee"));
});

test("the previously public status, version and health endpoints are locked down in source", () => {
  const status = readFileSync(join(root, "app/api/system/status/route.ts"), "utf8");
  const version = readFileSync(join(root, "app/api/version/route.ts"), "utf8");
  const health = readFileSync(join(root, "app/api/health/route.ts"), "utf8");
  assert.ok(status.includes("requireAdmin"), "system/status must require an admin");
  assert.ok(version.includes("requireAdmin"), "version must require an admin");
  assert.ok(!/version|environment|uptime/i.test(health.replace(/\/\/.*$/gm, "")), "health must not return version, environment or uptime");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
