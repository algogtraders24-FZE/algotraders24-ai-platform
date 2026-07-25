// scripts/validate-context-manager.ts
// Sprint 15C.2 - Standalone validation for services/ai/context-manager.service.ts.
// No test framework exists in this project (see package.json); this is a
// plain, dependency-free script (node:assert) run via `npm run validate:context`.
// No external API calls. No database calls.
import assert from "node:assert/strict";
import type { Message } from "../types/message";
import type { ContextInput } from "../types/ai-context";
import { ContextAssemblyError } from "../types/ai-context";
import { buildContext, selectRecentMessages, estimateTokens } from "../services/ai/context-manager.service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function msg(role: Message["role"], content: string, atMs: number): Message {
  return { id: `t-${atMs}`, role, content, createdAt: new Date(atMs).toISOString() };
}

function userMessage(content = "What is the current margin policy?"): Message {
  return msg("user", content, Date.now());
}

// ---------------------------------------------------------------------------

test("empty conversation history: no recent messages, output is [..system, userMessage]", () => {
  const input: ContextInput = { userMessage: userMessage("hello") };
  const ctx = buildContext(input);
  assert.equal(ctx.messages.length, 1);
  assert.equal(ctx.messages[0], input.userMessage);
  assert.equal(ctx.meta.recentMessagesTotal, 0);
  assert.equal(ctx.meta.recentMessagesIncluded, 0);
  assert.equal(ctx.meta.recentMessagesTruncated, false);
});

test("one recent message is included and ordered before the current message", () => {
  const prior = msg("assistant", "Sure, here is an overview.", 1000);
  const current = userMessage("follow up");
  const ctx = buildContext({ userMessage: current, recentMessages: [prior] });
  assert.deepEqual(ctx.messages, [prior, current]);
  assert.equal(ctx.meta.recentMessagesIncluded, 1);
});

test("multiple messages preserve chronological order", () => {
  const history = [
    msg("user", "first", 1000),
    msg("assistant", "second", 2000),
    msg("user", "third", 3000),
  ];
  const current = userMessage("fourth");
  const ctx = buildContext({ userMessage: current, recentMessages: history });
  assert.deepEqual(
    ctx.messages.map((m) => m.content),
    ["first", "second", "third", "fourth"],
  );
});

test("selectRecentMessages keeps the newest N in chronological order", () => {
  const history = [msg("user", "a", 1), msg("user", "b", 2), msg("user", "c", 3), msg("user", "d", 4)];
  const selected = selectRecentMessages(history, 2);
  assert.deepEqual(selected.map((m) => m.content), ["c", "d"]);
});

test("maximum recent message limit is enforced deterministically (oldest dropped first)", () => {
  const history = Array.from({ length: 30 }, (_, i) => msg("user", `msg-${i}`, i));
  const current = userMessage("current");
  const ctx = buildContext({ userMessage: current, recentMessages: history, limits: { maxRecentMessages: 5 } });
  assert.equal(ctx.meta.recentMessagesIncluded, 5);
  assert.equal(ctx.meta.recentMessagesTruncated, true);
  assert.deepEqual(
    ctx.messages.slice(0, 5).map((m) => m.content),
    ["msg-25", "msg-26", "msg-27", "msg-28", "msg-29"],
  );
});

test("context size limit trims oldest recent messages first, never the current message", () => {
  const history = [
    msg("user", "x".repeat(400), 1),
    msg("assistant", "y".repeat(400), 2),
    msg("user", "z".repeat(400), 3),
  ];
  const current = userMessage("w".repeat(100));
  const ctx = buildContext({
    userMessage: current,
    recentMessages: history,
    limits: { maxRecentMessages: 20, maxContextChars: 700, maxSummaryChars: 2000 },
  });
  // Budget only fits the current message plus the newest history entry.
  assert.equal(ctx.messages.at(-1), current);
  assert.equal(ctx.meta.recentMessagesTruncated, true);
  assert.ok(ctx.meta.estimatedChars <= 700, `estimatedChars ${ctx.meta.estimatedChars} should be <= 700`);
  assert.deepEqual(
    ctx.messages.map((m) => m.content),
    ["z".repeat(400), "w".repeat(100)],
  );
});

test("context size limit of 0 drops all recent history but keeps the current message", () => {
  const history = [msg("user", "a".repeat(50), 1)];
  const current = userMessage("still here");
  const ctx = buildContext({
    userMessage: current,
    recentMessages: history,
    limits: { maxRecentMessages: 20, maxContextChars: 0, maxSummaryChars: 2000 },
  });
  assert.deepEqual(ctx.messages, [current]);
  assert.equal(ctx.meta.recentMessagesIncluded, 0);
  assert.equal(ctx.meta.recentMessagesTruncated, true);
});

test("optional summary is included as a system-role message ahead of history", () => {
  const current = userMessage("q");
  const ctx = buildContext({ userMessage: current, summary: "User previously asked about pricing." });
  assert.equal(ctx.meta.summaryIncluded, true);
  assert.equal(ctx.messages[0].role, "system");
  assert.match(ctx.messages[0].content, /pricing/);
});

test("summary is capped at maxSummaryChars, never silently sent in full", () => {
  const current = userMessage("q");
  const longSummary = "s".repeat(5000);
  const ctx = buildContext({ userMessage: current, summary: longSummary, limits: { maxSummaryChars: 100 } });
  const summaryMsg = ctx.messages.find((m) => m.content.includes("Conversation summary:"));
  assert.ok(summaryMsg);
  assert.ok(summaryMsg!.content.length <= 100 + "Conversation summary:\n".length);
});

test("no summary provided: summaryIncluded is false and no summary message exists", () => {
  const ctx = buildContext({ userMessage: userMessage("q") });
  assert.equal(ctx.meta.summaryIncluded, false);
  assert.ok(!ctx.messages.some((m) => m.content.includes("Conversation summary:")));
});

test("optional RAG context is included as a system-role message", () => {
  const ctx = buildContext({ userMessage: userMessage("q"), ragContext: "Doc: margin requirements are 2%." });
  assert.equal(ctx.meta.ragContextIncluded, true);
  assert.ok(ctx.messages.some((m) => m.role === "system" && m.content.includes("margin requirements")));
});

test("no RAG context provided: ragContextIncluded is false", () => {
  const ctx = buildContext({ userMessage: userMessage("q") });
  assert.equal(ctx.meta.ragContextIncluded, false);
});

test("optional live search context is included as a system-role message", () => {
  const ctx = buildContext({ userMessage: userMessage("q"), liveSearchContext: "Gold is at $2,400 today." });
  assert.equal(ctx.meta.liveSearchContextIncluded, true);
  assert.ok(ctx.messages.some((m) => m.role === "system" && m.content.includes("Gold is at")));
});

test("no live search context provided: liveSearchContextIncluded is false", () => {
  const ctx = buildContext({ userMessage: userMessage("q") });
  assert.equal(ctx.meta.liveSearchContextIncluded, false);
});

test("deterministic ordering: system -> summary -> rag -> search -> history -> current message", () => {
  const history = [msg("user", "history-1", 1)];
  const ctx = buildContext({
    systemInstructions: "Be concise.",
    summary: "Prior summary.",
    ragContext: "RAG chunk.",
    liveSearchContext: "Search result.",
    recentMessages: history,
    userMessage: userMessage("current"),
  });
  const roles = ctx.messages.map((m) => m.content);
  assert.equal(roles[0], "Be concise.");
  assert.match(roles[1], /Prior summary\./);
  assert.match(roles[2], /RAG chunk\./);
  assert.match(roles[3], /Search result\./);
  assert.equal(roles[4], "history-1");
  assert.equal(roles[5], "current");
});

test("deterministic output: identical input produces identical shape and content twice", () => {
  const history = [msg("user", "a", 1), msg("assistant", "b", 2)];
  const build = (): ContextInput => ({
    systemInstructions: "Be helpful.",
    summary: "Summary.",
    ragContext: "RAG.",
    liveSearchContext: "Search.",
    recentMessages: history,
    userMessage: msg("user", "current", 3),
  });
  const a = buildContext(build());
  const b = buildContext(build());
  assert.deepEqual(
    a.messages.map((m) => ({ role: m.role, content: m.content })),
    b.messages.map((m) => ({ role: m.role, content: m.content })),
  );
  assert.deepEqual(a.meta, b.meta);
});

test("current user message is always the last message and is never dropped or altered", () => {
  const history = Array.from({ length: 50 }, (_, i) => msg("user", "h".repeat(500), i));
  const current = userMessage("must survive");
  const ctx = buildContext({
    userMessage: current,
    recentMessages: history,
    limits: { maxRecentMessages: 50, maxContextChars: 10, maxSummaryChars: 2000 },
  });
  assert.equal(ctx.messages.at(-1), current);
  assert.equal(ctx.messages.at(-1)!.content, "must survive");
});

test("empty userMessage content is rejected", () => {
  assert.throws(
    () => buildContext({ userMessage: msg("user", "   ", Date.now()) }),
    ContextAssemblyError,
  );
});

test("invalid limits are rejected deterministically", () => {
  assert.throws(
    () => buildContext({ userMessage: userMessage(), limits: { maxRecentMessages: -1 } }),
    ContextAssemblyError,
  );
});

test("estimateTokens matches the documented chars/4 estimate", () => {
  assert.equal(estimateTokens(400), 100);
  assert.equal(estimateTokens(1), 1);
  assert.equal(estimateTokens(0), 0);
});

test("no network or database globals are touched (pure module sanity check)", () => {
  // buildContext must not reach for fetch/prisma; this is a structural
  // sanity check, not a mock - the module simply never imports them.
  const src = buildContext.toString();
  assert.ok(!src.includes("fetch("));
  assert.ok(!src.includes("prisma"));
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
