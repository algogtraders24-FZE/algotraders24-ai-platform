// scripts/validate-support-tokens.ts
// AT24 Copilot Phase 3.3 - the answer is shown as it is written (sentence by sentence, each scanned first).
// Run: npm run validate:support-tokens   (provider SSE parsing is pure; the compose tests use real AgentRun rows + fakes)
process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ClaudeProvider } from "../lib/ai/providers/claude.provider";
import { AIProviderError } from "../lib/ai/errors";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { runSupportAgent } from "../services/agent-framework/agents/support-agent";
import { composeSupportAnswerStreaming, createSentenceGate, type TextStreamer } from "../services/support/compose-answer";
import type { GenerationSlot } from "../services/support/generate-answer";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";

const USER = `validate-support-tokens-${process.pid}-${Date.now().toString(36)}`;
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
    console.log(`  FAIL - ${name}\n    ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

// ── SSE helpers ─────────────────────────────────────────────────────────────
function sse(events: object[]): string {
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}
function streamOf(text: string, chunk = 17): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}
const delta = (text: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const REQ = { messages: [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "hi" }] };

function provider(fetchBody: string, ok = true, status = 200): ClaudeProvider {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key";
  return new ClaudeProvider({
    streamFetchImpl: async () => ({ ok, status, body: ok ? streamOf(fetchBody) : null }),
  });
}

async function collect(gen: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const t of gen) out += t;
  return out;
}

// ── run fixtures (same shape as validate-support-compose.ts) ───────────────
const PASSAGE = "You can change your plan yourself from Settings -> Billing. An upgrade takes effect immediately.";
function fakeKb(): ToolImplementation<Record<string, never>, { hits: unknown[]; available: boolean }> {
  return {
    definition: {
      id: "support.knowledge_search", name: "support.knowledge_search", description: "fake", version: "1.0.0",
      category: "SUPPORT", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_RUN_SUPPORT"], autonomyFloor: 0, creditCost: { model: "flat", credits: 1 },
      executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["research_document"], provenanceProducer: "fake-support" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      return {
        output: { hits: [{ claim: PASSAGE, topic: "faq", relevance: 0.83 }], available: true },
        evidence: [{
          type: "research_document", claim: PASSAGE, source: "support-kb:faq", sourceId: "support-kb:t", timestamp: now,
          data: { topic: "faq", title: "fixture", similarity: 0.83, content: PASSAGE }, relevance: 0.83, confidence: 0.83,
          provenance: { producer: "fake-support", retrievedAt: now },
        }],
      };
    },
  };
}
function fakeAccount(): ToolImplementation<Record<string, never>, { snapshot: unknown; domains: string[] }> {
  return {
    definition: {
      id: "support.account_read", name: "support.account_read", description: "fake", version: "1.0.0",
      category: "ACCOUNT", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_READ_ACCOUNT_RECORDS"], autonomyFloor: 0, creditCost: { model: "flat", credits: 1 },
      executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["derived"], provenanceProducer: "fake-account" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => ({ output: { snapshot: {}, domains: [] }, evidence: [] }),
  };
}
async function answeredRun(question: string) {
  const registry = new ToolRegistry().register(fakeKb()).register(fakeAccount()).freeze();
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store: new InMemoryEvaluationStore() });
  const rt = new AgentRuntime({ registry, creditLedger: ledger, evaluation });
  const final = await runSupportAgent({ userId: USER, goal: { question }, runtime: rt });
  assert.equal(final?.status, "succeeded");
  return final!;
}
const streamer = (parts: string[]): TextStreamer => async function* () { for (const p of parts) yield p; };
const slot = (text: string): GenerationSlot => ({ name: "fake", isAvailable: () => true, complete: async () => text });

async function main(): Promise<void> {
  console.log("\nAT24 Copilot Phase 3.3 - streamed answers\n");
  await agentRunRepository._deleteRunsForUser(USER);

  await test("provider: yields the text deltas of an SSE stream, even when events are split across chunks", async () => {
    const body = sse([{ type: "message_start" }, delta("Open Settings, "), delta("then Billing."), { type: "message_stop" }]);
    assert.equal(await collect(provider(body).streamText(REQ)), "Open Settings, then Billing.");
  });

  await test("provider: ignores non-text events and a malformed data line", async () => {
    const body = sse([{ type: "ping" }, delta("A")]) + "event: x\ndata: {not json}\n\n" + sse([delta("B"), { type: "message_stop" }]);
    assert.equal(await collect(provider(body).streamText(REQ)), "AB");
  });

  await test("provider: an SSE error event throws an AIProviderError", async () => {
    const body = sse([delta("partial "), { type: "error", error: { message: "overloaded" } }]);
    await assert.rejects(() => collect(provider(body).streamText(REQ)), (e: unknown) => e instanceof AIProviderError);
  });

  await test("provider: a non-OK HTTP status throws (auth / rate_limit / network kinds)", async () => {
    for (const [status, kind] of [[401, "auth"], [429, "rate_limit"], [500, "network"]] as const) {
      await assert.rejects(
        () => collect(provider("", false, status).streamText(REQ)),
        (e: unknown) => e instanceof AIProviderError && e.kind === kind,
      );
    }
  });

  await test("sentence gate: only whole sentences are released; the unfinished tail waits", () => {
    const g = createSentenceGate();
    assert.deepEqual(g.push("Open Settings, then"), { release: "", blocked: false });
    assert.deepEqual(g.push(" Billing. Pick a"), { release: "Open Settings, then Billing. ", blocked: false });
    assert.deepEqual(g.push(" tier."), { release: "", blocked: false });
    assert.deepEqual(g.flush(), { release: "Pick a tier.", blocked: false });
  });

  await test("sentence gate: a forbidden sentence is blocked BEFORE it is released", () => {
    const g = createSentenceGate();
    const a = g.push("Open Settings. This is a guaranteed profit, buy now. ");
    assert.equal(a.blocked, true);
    assert.equal(a.release, "Open Settings. ");
    assert.ok(!a.release.includes("guaranteed profit"));
  });

  await test("sentence gate: handles list items and newlines as boundaries", () => {
    const g = createSentenceGate();
    const r = g.push("1. Open Settings\n2. Pick Billing\n");
    assert.equal(r.blocked, false);
    assert.ok(r.release.includes("Open Settings") && r.release.includes("Pick Billing"));
  });

  await test("stream compose: tokens arrive sentence by sentence, in order, and the full text is stored as composedAnswer", async () => {
    const run = await answeredRun("How do I change my billing tier?");
    const got: string[] = [];
    const ok = await composeSupportAnswerStreaming(run.id, USER, (t) => got.push(t), {
      streamer: streamer(["Open Settings, then", " Billing. ", "Pick a tier", " and confirm."]),
    });
    assert.equal(ok, true);
    assert.equal(got.join(""), "Open Settings, then Billing. Pick a tier and confirm.");
    assert.ok(got.length >= 2, "text must arrive in more than one piece");
    const out = (await agentRunRepository.getRunForUser(run.id, USER))!.output as { composedAnswer?: string; composedProvider?: string; coverage?: string };
    assert.equal(out.composedAnswer, "Open Settings, then Billing. Pick a tier and confirm.");
    assert.equal(out.composedProvider, "claude");
    assert.equal(out.coverage, "kb-answered");
  });

  await test("stream compose: a forbidden sentence mid-stream stops it, stores nothing, and shows only the clean sentences before it", async () => {
    const run = await answeredRun("How do I change my billing tier again?");
    const before = JSON.stringify((await agentRunRepository.getRunForUser(run.id, USER))!.output);
    const got: string[] = [];
    const ok = await composeSupportAnswerStreaming(run.id, USER, (t) => got.push(t), {
      streamer: streamer(["Open Settings. ", "This is a guaranteed profit, buy now. ", "Done."]),
    });
    assert.equal(ok, false);
    assert.ok(!got.join("").includes("guaranteed profit"));
    assert.equal(JSON.stringify((await agentRunRepository.getRunForUser(run.id, USER))!.output), before);
  });

  await test("stream compose: the stream failing BEFORE any text falls back to the normal provider chain (one piece)", async () => {
    const run = await answeredRun("How do I change my billing tier a third time?");
    const got: string[] = [];
    const failing: TextStreamer = async function* () { throw new Error("stream down"); };
    const ok = await composeSupportAnswerStreaming(run.id, USER, (t) => got.push(t), { streamer: failing, slots: [slot("Go to Settings then Billing.")] });
    assert.equal(ok, true);
    assert.deepEqual(got, ["Go to Settings then Billing."]);
  });

  await test("stream compose: the stream failing AFTER text was shown returns false (the caller discards the shown text)", async () => {
    const run = await answeredRun("How do I change my billing tier a fourth time?");
    const got: string[] = [];
    const dying: TextStreamer = async function* () { yield "Open Settings. "; throw new Error("dropped"); };
    const ok = await composeSupportAnswerStreaming(run.id, USER, (t) => got.push(t), { streamer: dying, slots: [slot("unused")] });
    assert.equal(ok, false);
    assert.deepEqual(got, ["Open Settings. "]);
    const out = (await agentRunRepository.getRunForUser(run.id, USER))!.output as { composedAnswer?: unknown };
    assert.equal(out.composedAnswer, undefined);
  });

  await test("stream compose: no streamer available uses the normal chain; a mutation request is never composed", async () => {
    const run = await answeredRun("How do I change my billing tier a fifth time?");
    const got: string[] = [];
    assert.equal(await composeSupportAnswerStreaming(run.id, USER, (t) => got.push(t), { streamer: null, slots: [slot("Open Settings, then Billing.")] }), true);
    const mut = await answeredRun("Please cancel my subscription");
    assert.equal(await composeSupportAnswerStreaming(mut.id, USER, () => undefined, { streamer: streamer(["Done, cancelled."]) }), false);
  });

  await test("route wiring: the stream route composes itself (skipComposition), emits token and reset events, sentence-scanned", () => {
    const route = readFileSync(join(ROOT, "app", "api", "private", "support", "ask", "route.ts"), "utf8");
    assert.match(route, /skipComposition: true/);
    assert.match(route, /composeSupportAnswerStreaming\(/);
    assert.match(route, /type: "token"/);
    assert.match(route, /type: "reset"/);
    const svc = readFileSync(join(ROOT, "services", "agent-framework", "api", "agent-run-service.ts"), "utf8");
    assert.match(svc, /!options\.skipComposition/);
  });

  await test("client wiring: the hook shows streamed text and clears it on reset / when done", () => {
    const hook = readFileSync(join(ROOT, "hooks", "useSupportRun.ts"), "utf8");
    assert.match(hook, /event\.type === "token"/);
    assert.match(hook, /event\.type === "reset"/);
    assert.match(hook, /setStreamingText\(""\)/);
    for (const f of [join("app", "dashboard", "support", "page.tsx"), join("components", "support", "SupportWidget.tsx")]) {
      assert.match(readFileSync(join(ROOT, f), "utf8"), /streamingText/, `${f} must render streamingText`);
    }
  });

  await agentRunRepository._deleteRunsForUser(USER);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await agentRunRepository._deleteRunsForUser(USER);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
