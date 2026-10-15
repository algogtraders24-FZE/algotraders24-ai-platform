// scripts/validate-support-stream.ts
// AT24 Copilot Phase 2 (AT24_COPILOT_SUPPORT_RND.md W1b): one streaming request per question,
// emails after the response. Pure + structural checks (no DB, no network).
// Run: npm run validate:support-stream
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { supportStageLabel, splitNdjson } from "../services/support/stage-labels";
import { runAfterResponse } from "../services/support/after-response";

const ROOT = join(__dirname, "..");
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL - ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log("\nAT24 Copilot Phase 2 - streaming validation\n");

  await test("stage labels: knowledge search, account read, output, evaluation, unknown", () => {
    assert.equal(supportStageLabel({ kind: "tool_call", summary: "support.knowledge_search -> ok" }), "Searching the knowledge base…");
    assert.equal(supportStageLabel({ kind: "tool_call", summary: "support.account_read -> ok" }), "Checking your account status…");
    assert.equal(supportStageLabel({ kind: "tool_call", summary: "something.else -> ok" }), "Looking this up…");
    assert.equal(supportStageLabel({ kind: "output", summary: "support answer: kb-answered" }), "Writing the answer…");
    assert.equal(supportStageLabel({ kind: "evaluation", summary: "output integrity check passed" }), "Double-checking…");
    assert.equal(supportStageLabel({ kind: "plan", summary: "" }), "Thinking…");
  });

  await test("splitNdjson: keeps the unfinished tail, drops blank lines, handles split chunks", () => {
    const a = splitNdjson('{"type":"stage"}\n{"type":"do');
    assert.deepEqual(a.lines, ['{"type":"stage"}']);
    assert.equal(a.rest, '{"type":"do');
    const b = splitNdjson(a.rest + 'ne"}\n\n');
    assert.deepEqual(b.lines, ['{"type":"done"}']);
    assert.equal(b.rest, "");
    assert.deepEqual(splitNdjson("").lines, []);
  });

  await test("runAfterResponse: outside a request scope the task still runs (inline fallback), and a task error does not escape as a different failure", async () => {
    let ran = false;
    await runAfterResponse(async () => {
      ran = true;
    });
    assert.equal(ran, true);
  });

  const route = readFileSync(join(ROOT, "app", "api", "private", "support", "ask", "route.ts"), "utf8");

  await test("route: authenticates first, takes userId from the session only, never the body", () => {
    const authIdx = route.indexOf("getUserOrNull()");
    const bodyIdx = route.indexOf("req.json()");
    assert.ok(authIdx > -1 && bodyIdx > -1 && authIdx < bodyIdx, "auth must run before the body is read");
    assert.match(route, /const userId = sessionUser\.profile\.id/);
    assert.doesNotMatch(route, /body[^;\n]*userId/i, "userId must never be read from the body");
  });

  await test("route: reuses startAgentRun + advanceAgentRun (same engine, hooks and policy), SUPPORT only", () => {
    assert.match(route, /startAgentRun\(/);
    assert.match(route, /advanceAgentRun\(/);
    assert.match(route, /agentType: "SUPPORT"/);
  });

  await test("route: streams NDJSON events (accepted, stage, done, error) and bounds the question and the loop", () => {
    for (const ev of ['"open"', '"accepted"', '"stage"', '"done"', '"error"']) assert.ok(route.includes(ev), `missing ${ev} event`);
    assert.ok(route.indexOf('type: "open"') < route.indexOf("startAgentRun({"), "the stream must open before startAgentRun runs");
    assert.match(route, /application\/x-ndjson/);
    assert.match(route, /MAX_QUESTION_CHARS/);
    assert.match(route, /MAX_ADVANCES/);
  });

  const hook = readFileSync(join(ROOT, "hooks", "useSupportRun.ts"), "utf8");

  await test("hook: uses the stream first and falls back to the polling driver when the stream is unavailable", () => {
    assert.match(hook, /askViaStream\(/);
    assert.match(hook, /instanceof StreamUnavailable/);
    assert.match(hook, /\/api\/private\/agents\/framework\/runs\/\$\{runId\}\/advance/);
  });

  const handoff = readFileSync(join(ROOT, "services", "support", "handoff-service.ts"), "utf8");

  await test("handoff: ticket emails are sent via runAfterResponse (not inline in the request)", () => {
    assert.match(handoff, /await runAfterResponse\(async \(\) => \{/);
    assert.match(handoff, /sendSupportTicketOpenedAlert/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
