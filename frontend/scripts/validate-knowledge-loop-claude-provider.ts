// scripts/validate-knowledge-loop-claude-provider.ts
// Sprint K3-B-1 — ClaudeProvider native web_search extension (K3_PREFLIGHT §4.1).
// Sprint K3-C (C1) — server-tool lifecycle hardening
//   (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12.5, K3C_DECISION D-K3C-1).
// Offline: every HTTP round trip is an INJECTED ClaudeFetch double. ZERO
// network, ZERO real API key (a fixture key satisfies the constructor).
//
// Run: npm run validate:knowledge-loop-claude-provider
//
// Proves (K3-B-1):
//   - a request with NO `tools` is byte-identical to pre-K3 (no `tools` key in
//     the body; response has no webSources/searchCount)
//   - `tools: [{kind:"web_search"}]` → body carries `web_search_20250305` with
//     max_uses / domain / user_location mapping
//   - `web_search_tool_result` list → webSources populated, citations merged,
//     `encrypted_content` carried, `searchCount` from usage
//   - `web_search_tool_result_error` (HTTP 200) → NO throw; webSearchUnavailable
//   - `stop_reason: "pause_turn"` → one continuation (paused assistant turn
//     resent verbatim), then `end_turn`; continuation loop is capped
//   - HTTP 401/429 still throw typed AIProviderError
// Proves (K3-C C1 — §12.5):
//   - `server_tool_use` counted only when `name === "web_search"`
//   - mixed ok+error searches → webSearchFailed + webSearchPartialFailure,
//     webSearchUnavailable=false, the OK source is kept (no silent swallow)
//   - single search error → webSearchFailed + webSearchUnavailable
//   - valid-but-empty result list → webSearchUnavailable, NOT webSearchFailed
//   - unrecognised web_search_tool_result.content shape → counted as an error
//   - pause_turn that never resolves → continuationBudgetExhausted=true after
//     the cap (a paused/placeholder body is flagged, never silently "complete")
//   - stop_reason "max_tokens" → truncated=true, content still returned
//   - HTTP !ok with an Anthropic error body → the error message is surfaced

import assert from "node:assert/strict";

// Set BEFORE any ClaudeProvider is constructed (loadAnthropicEnv runs in the
// constructor, not at import). Every HTTP call is an injected double — this
// fixture key is never sent anywhere real.
process.env.ANTHROPIC_API_KEY ||= "sk-ant-fixture-key-not-real";
process.env.ANTHROPIC_MODEL ||= "claude-sonnet-5";

import { ClaudeProvider, type ClaudeFetch } from "../lib/ai/providers/claude.provider";
import { AIProviderError } from "../lib/ai/errors";
import type { AICompletionRequest } from "../lib/ai/types";

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
    console.error(err instanceof Error ? `    ${err.stack ?? err.message}` : `    ${String(err)}`);
  }
}

/** an injected fetch that records the request bodies and replays queued responses. */
function scriptedFetch(responses: Array<{ ok?: boolean; status?: number; json: unknown }>): {
  fetch: ClaudeFetch;
  bodies: Record<string, unknown>[];
} {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  const fetch: ClaudeFetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json,
    };
  };
  return { fetch, bodies };
}

const textBlock = (t: string) => ({ type: "text", text: t });

async function main(): Promise<void> {
  console.log("\nK3-B-1 — ClaudeProvider native web_search\n");

  await test("no tools → body has no `tools` key; response has no web fields (backward compat)", async () => {
    const { fetch, bodies } = scriptedFetch([
      { json: { content: [textBlock("plain answer")], model: "claude-sonnet-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);
    const p = new ClaudeProvider({ fetchImpl: fetch });
    const r = await p.complete({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.content, "plain answer");
    assert.equal(bodies.length, 1);
    assert.equal("tools" in bodies[0], false, "no-tools request must not send a tools array");
    assert.equal(r.webSources, undefined);
    assert.equal(r.searchCount, undefined);
    assert.equal(r.webSearchUnavailable, undefined);
  });

  await test("web_search spec → body carries web_search_20250305 with param mapping", async () => {
    const { fetch, bodies } = scriptedFetch([
      { json: { content: [textBlock("answer")], stop_reason: "end_turn" } },
    ]);
    const p = new ClaudeProvider({ fetchImpl: fetch });
    await p.complete({
      messages: [{ role: "user", content: "latest news" }],
      tools: [{ kind: "web_search", maxUses: 3, blockedDomains: ["spam.example"], userLocation: { country: "IN", timezone: "Asia/Kolkata" } }],
    });
    const tools = bodies[0].tools as Record<string, unknown>[];
    assert.equal(tools[0].type, "web_search_20250305");
    assert.equal(tools[0].name, "web_search");
    assert.equal(tools[0].max_uses, 3);
    assert.deepEqual(tools[0].blocked_domains, ["spam.example"]);
    assert.deepEqual(tools[0].user_location, { type: "approximate", country: "IN", timezone: "Asia/Kolkata" });
  });

  await test("allowedDomains XOR blockedDomains — allowed wins, blocked dropped", async () => {
    const { fetch, bodies } = scriptedFetch([{ json: { content: [textBlock("a")], stop_reason: "end_turn" } }]);
    const p = new ClaudeProvider({ fetchImpl: fetch });
    await p.complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search", allowedDomains: ["docs.example"], blockedDomains: ["x.example"] }],
    });
    const tools = bodies[0].tools as Record<string, unknown>[];
    assert.deepEqual(tools[0].allowed_domains, ["docs.example"]);
    assert.equal("blocked_domains" in tools[0], false);
  });

  await test("web_search_tool_result list → webSources + merged citations + encrypted_content + searchCount", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          model: "claude-sonnet-5",
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 1 } },
          content: [
            textBlock("I'll search."),
            { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "node lts" } },
            {
              type: "web_search_tool_result",
              tool_use_id: "srv_1",
              content: [
                { type: "web_search_result", url: "https://nodejs.org/en/about/releases", title: "Node Releases", page_age: "September 1, 2026", encrypted_content: "ENC_A" },
                { type: "web_search_result", url: "https://example.com/node", title: "Example", encrypted_content: "ENC_B" },
              ],
            },
            {
              type: "text",
              text: "The current LTS is 24.",
              citations: [
                { type: "web_search_result_location", url: "https://nodejs.org/en/about/releases", title: "Node Releases", cited_text: "Node.js 24 entered LTS on ..." },
              ],
            },
          ],
        },
      },
    ]);
    const p = new ClaudeProvider({ fetchImpl: fetch });
    const r = await p.complete({
      messages: [{ role: "user", content: "what is the current node lts" }],
      tools: [{ kind: "web_search", maxUses: 2 }],
    });
    assert.equal(r.content, "I'll search.The current LTS is 24.");
    assert.equal(r.searchCount, 1);
    assert.equal(r.webSearchUnavailable, false);
    assert.equal(r.stopReason, "end_turn");
    assert.ok(r.webSources && r.webSources.length === 2);
    const nodeSrc = r.webSources.find((s) => s.url.includes("nodejs.org"))!;
    assert.equal(nodeSrc.title, "Node Releases");
    assert.equal(nodeSrc.pageAge, "September 1, 2026");
    assert.equal(nodeSrc.encryptedContent, "ENC_A");
    assert.deepEqual(nodeSrc.citedTexts, ["Node.js 24 entered LTS on ..."]);
  });

  await test("web_search_tool_result_error (HTTP 200) → NO throw; webSearchUnavailable=true; answer preserved", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          stop_reason: "end_turn",
          content: [
            textBlock("Let me look that up."),
            { type: "server_tool_use", id: "srv_2", name: "web_search", input: { query: "x" } },
            { type: "web_search_tool_result", tool_use_id: "srv_2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
            textBlock(" Based on what I know, ..."),
          ],
        },
      },
    ]);
    const p = new ClaudeProvider({ fetchImpl: fetch });
    const r = await p.complete({ messages: [{ role: "user", content: "q" }], tools: [{ kind: "web_search", maxUses: 1 }] });
    assert.equal(r.webSearchUnavailable, true);
    assert.ok(r.content.includes("Based on what I know"));
    assert.deepEqual(r.webSources, []);
  });

  await test("pause_turn → one continuation (paused assistant turn resent verbatim) then end_turn", async () => {
    const pausedBlocks = [
      textBlock("searching…"),
      { type: "server_tool_use", id: "srv_3", name: "web_search", input: { query: "a" } },
      { type: "web_search_tool_result", tool_use_id: "srv_3", content: [{ type: "web_search_result", url: "https://a.example", title: "A", encrypted_content: "ENC_P" }] },
    ];
    const { fetch, bodies } = scriptedFetch([
      { json: { stop_reason: "pause_turn", content: pausedBlocks, usage: { server_tool_use: { web_search_requests: 1 } } } },
      { json: { stop_reason: "end_turn", content: [textBlock("done, the answer is 42.")], usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 1 } } } },
    ]);
    const p = new ClaudeProvider({ fetchImpl: fetch });
    const r = await p.complete({ messages: [{ role: "user", content: "compute" }], tools: [{ kind: "web_search" }] });
    assert.equal(bodies.length, 2, "one continuation request");
    const secondMsgs = bodies[1].messages as Array<{ role: string; content: unknown }>;
    assert.equal(secondMsgs.length, 2);
    assert.equal(secondMsgs[1].role, "assistant");
    assert.deepEqual(secondMsgs[1].content, pausedBlocks, "paused assistant turn resent VERBATIM (incl encrypted_content)");
    assert.equal(r.content, "done, the answer is 42.");
    assert.equal(r.stopReason, "end_turn");
    assert.equal(r.searchCount, 1);
  });

  await test("pause_turn loop is capped (never infinite)", async () => {
    const { fetch, bodies } = scriptedFetch([
      // always pause — the provider must stop after the cap and still return the last text
      { json: { stop_reason: "pause_turn", content: [textBlock("still going")], usage: {} } },
    ]);
    const p = new ClaudeProvider({ fetchImpl: fetch });
    const r = await p.complete({ messages: [{ role: "user", content: "loop" }], tools: [{ kind: "web_search" }] });
    assert.ok(bodies.length <= 4, `capped at ≤4 POSTs, got ${bodies.length}`);
    assert.equal(r.content, "still going");
  });

  await test("HTTP 401 → AIProviderError kind=auth; 429 → kind=rate_limit", async () => {
    const p401 = new ClaudeProvider({ fetchImpl: scriptedFetch([{ ok: false, status: 401, json: {} }]).fetch });
    await assert.rejects(
      () => p401.complete({ messages: [{ role: "user", content: "q" }] }),
      (e: unknown) => e instanceof AIProviderError && e.kind === "auth",
    );
    const p429 = new ClaudeProvider({ fetchImpl: scriptedFetch([{ ok: false, status: 429, json: {} }]).fetch });
    await assert.rejects(
      () => p429.complete({ messages: [{ role: "user", content: "q" }] }),
      (e: unknown) => e instanceof AIProviderError && e.kind === "rate_limit",
    );
  });

  await test("empty text response still throws invalid_output (unchanged)", async () => {
    const p = new ClaudeProvider({ fetchImpl: scriptedFetch([{ json: { content: [], stop_reason: "end_turn" } }]).fetch });
    await assert.rejects(
      () => p.complete({ messages: [{ role: "user", content: "q" }] } as AICompletionRequest),
      (e: unknown) => e instanceof AIProviderError && e.kind === "invalid_output",
    );
  });

  // ── K3-C C1 — server-tool lifecycle hardening (§12.5) ──────────────────
  console.log("\n  K3-C C1 — server-tool lifecycle\n");

  await test("C1: server_tool_use with a non-web_search name is NOT counted", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          stop_reason: "end_turn",
          content: [
            textBlock("thinking"),
            { type: "server_tool_use", id: "srv_x", name: "code_execution", input: {} },
            { type: "server_tool_use", id: "srv_y", name: "web_search", input: { query: "q" } },
            { type: "web_search_tool_result", tool_use_id: "srv_y", content: [{ type: "web_search_result", url: "https://a.example", title: "A" }] },
            textBlock(" answer."),
          ],
        },
      },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search" }],
    });
    assert.equal(r.searchCount, 1, "only the web_search server_tool_use counts");
    assert.equal(r.webSearchFailed, false);
  });

  await test("C1: mixed ok + error searches → partial failure, OK source kept, unavailable=false", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          stop_reason: "end_turn",
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "a" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://ok.example", title: "OK", encrypted_content: "ENC_OK" }] },
            { type: "server_tool_use", id: "s2", name: "web_search", input: { query: "b" } },
            { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "too_many_requests" } },
            { type: "text", text: "Partial answer.", citations: [{ type: "web_search_result_location", url: "https://ok.example", title: "OK", cited_text: "fact" }] },
          ],
        },
      },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search", maxUses: 2 }],
    });
    assert.equal(r.webSearchFailed, true, "one operation failed");
    assert.equal(r.webSearchPartialFailure, true, "one ok + one error");
    assert.equal(r.webSearchUnavailable, false, "a usable result was returned");
    assert.equal(r.searchCount, 2);
    assert.ok(r.webSources && r.webSources.some((s) => s.url === "https://ok.example"), "the OK source is NOT swallowed");
  });

  await test("C1: single search error → webSearchFailed AND webSearchUnavailable, not partial", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          stop_reason: "end_turn",
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "a" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
            textBlock("From my own knowledge, ..."),
          ],
        },
      },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search", maxUses: 1 }],
    });
    assert.equal(r.webSearchFailed, true);
    assert.equal(r.webSearchUnavailable, true);
    assert.equal(r.webSearchPartialFailure, false);
    assert.ok(r.content.includes("own knowledge"));
  });

  await test("C1: valid-but-empty result list → webSearchUnavailable, NOT webSearchFailed", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          stop_reason: "end_turn",
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "obscure" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
            textBlock("I couldn't find anything on that."),
          ],
        },
      },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search", maxUses: 1 }],
    });
    assert.equal(r.webSearchUnavailable, true, "no usable results");
    assert.equal(r.webSearchFailed, false, "the search ran fine — zero matches is not a failure");
  });

  await test("C1: unrecognised web_search_tool_result.content shape → counted as an error (not silent)", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          stop_reason: "end_turn",
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "a" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: { type: "something_unexpected" } },
            textBlock("answer"),
          ],
        },
      },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search", maxUses: 1 }],
    });
    assert.equal(r.webSearchFailed, true);
    assert.equal(r.webSearchUnavailable, true);
  });

  await test("C1: pause_turn that never resolves → continuationBudgetExhausted after the cap", async () => {
    const { fetch, bodies } = scriptedFetch([
      { json: { stop_reason: "pause_turn", content: [textBlock("still searching…"), { type: "server_tool_use", id: "s", name: "web_search", input: { query: "x" } }], usage: {} } },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "loop" }],
      tools: [{ kind: "web_search" }],
    });
    assert.equal(r.continuationBudgetExhausted, true, "flagged so the orchestrator can abandon the slot");
    assert.equal(r.stopReason, "pause_turn");
    assert.ok((r.continuationCount ?? 0) >= 1, `made ${r.continuationCount} continuation POSTs`);
    assert.ok(bodies.length <= 4, "still capped");
  });

  await test("C1: pause_turn that resolves → continuationBudgetExhausted=false, continuationCount tracked", async () => {
    const paused = [textBlock("searching"), { type: "server_tool_use", id: "s", name: "web_search", input: { query: "x" } }];
    const { fetch } = scriptedFetch([
      { json: { stop_reason: "pause_turn", content: paused, usage: {} } },
      { json: { stop_reason: "pause_turn", content: paused, usage: {} } },
      { json: { stop_reason: "end_turn", content: [textBlock("final answer")], usage: { server_tool_use: { web_search_requests: 1 } } } },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search" }],
    });
    assert.equal(r.content, "final answer");
    assert.equal(r.continuationBudgetExhausted, false);
    assert.equal(r.continuationCount, 2, "two continuation POSTs before it resolved");
  });

  await test("C1: stop_reason 'max_tokens' → truncated=true, content still returned", async () => {
    const { fetch } = scriptedFetch([
      { json: { stop_reason: "max_tokens", content: [textBlock("this answer was cut off mid-")], usage: { input_tokens: 5, output_tokens: 2048 } } },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({ messages: [{ role: "user", content: "q" }] });
    assert.equal(r.truncated, true);
    assert.equal(r.stopReason, "max_tokens");
    assert.ok(r.content.length > 0);
  });

  await test("C1: HTTP 400 with an Anthropic error body → message surfaced (typed, no raw request body)", async () => {
    const p = new ClaudeProvider({
      fetchImpl: scriptedFetch([
        { ok: false, status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "web search is not enabled for this organization" } } },
      ]).fetch,
    });
    await assert.rejects(
      () => p.complete({ messages: [{ role: "user", content: "SENSITIVE-USER-QUERY" }], tools: [{ kind: "web_search" }] }),
      (e: unknown) =>
        e instanceof AIProviderError &&
        /web search is not enabled/i.test(e.message) &&
        !e.message.includes("SENSITIVE-USER-QUERY"),
    );
  });

  await test("C1: clean single successful search → all failure flags false", async () => {
    const { fetch } = scriptedFetch([
      {
        json: {
          stop_reason: "end_turn",
          usage: { server_tool_use: { web_search_requests: 1 } },
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "a" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://a.example", title: "A", encrypted_content: "ENC" }] },
            { type: "text", text: "Answer.", citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A", cited_text: "c" }] },
          ],
        },
      },
    ]);
    const r = await new ClaudeProvider({ fetchImpl: fetch }).complete({
      messages: [{ role: "user", content: "q" }],
      tools: [{ kind: "web_search" }],
    });
    assert.equal(r.webSearchFailed, false);
    assert.equal(r.webSearchPartialFailure, false);
    assert.equal(r.webSearchUnavailable, false);
    assert.equal(r.continuationBudgetExhausted, false);
    assert.equal(r.truncated, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
