// scripts/validate-conversation-history-sync.ts
// Sprint 15C.6 - Standalone validation for server conversation history
// read-back: GET /api/private/conversations/[conversationId]/messages
// (validated here via ConversationMessageService.getMessages, the exact
// function the route calls - see the structural check below) and the new
// client-side hydration path (assistant.service.ts.loadServerMessages,
// conversation-manager.service.ts.hydrateFromServer). No test framework
// exists in this project; run via `npm run validate:history-sync`.
//
// Two halves, matching the two things this sprint touched:
//   1. DB-backed (real Postgres, self-cleaning) - the server side.
//   2. Mocked-fetch + Node's in-memory storage fallback (same pattern as
//      validate-client-conversation-identity.ts) - the client side.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { ConversationMessageService } from "../services/ai/conversation-message.service";
import { EntityNotFoundError } from "../types/repository";
import * as mgr from "../services/ai/conversation-manager.service";
import { loadServerMessages } from "../services/ai/assistant.service";
import type { StoredConversation } from "../types/conversation-metadata";
import type { Message } from "../types/message";

const RUN_TAG = `sprint15c6-${Date.now()}`;
const service = new ConversationMessageService();

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

function msg(role: Message["role"], content: string, atMs: number): Message {
  return { id: `t-${atMs}`, role, content, createdAt: new Date(atMs).toISOString() };
}

// ---------------------------------------------------------------------------
// Part 1: server side (real DB, self-cleaning)
// ---------------------------------------------------------------------------
async function runServerTests(): Promise<void> {
  const owner = await prisma.user.create({
    data: { email: `${RUN_TAG}-owner@internal.test`, name: "History Sync Owner" },
  });
  const stranger = await prisma.user.create({
    data: { email: `${RUN_TAG}-stranger@internal.test`, name: "History Sync Stranger" },
  });
  const conversation = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.6 history sync validation" },
  });
  const emptyConversation = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.6 empty conversation" },
  });

  try {
    await test("the new route reuses ConversationMessageService rather than querying Prisma directly (structural check)", () => {
      const source = readFileSync(
        new URL(
          "../app/api/private/conversations/[conversationId]/messages/route.ts",
          import.meta.url,
        ),
        "utf8",
      );
      assert.ok(source.includes("ConversationMessageService"), "route must reuse the existing service");
      assert.ok(source.includes("getMessages"), "route must call the existing getMessages method");
      assert.ok(!source.includes("prisma.message"), "route must not query the Message table directly");
    });

    await test("empty conversation: loading history returns an empty array, not an error", async () => {
      const messages = await service.getMessages(emptyConversation.id, owner.id);
      assert.deepEqual(messages, []);
    });

    await test("chronological order is preserved when loading history for the read route", async () => {
      await service.addUserMessage(conversation.id, owner.id, "first");
      await service.addAssistantMessage(conversation.id, owner.id, "second");
      await service.addUserMessage(conversation.id, owner.id, "third");

      const messages = await service.getMessages(conversation.id, owner.id);
      assert.deepEqual(messages.map((m) => m.content), ["first", "second", "third"]);
      for (let i = 1; i < messages.length; i += 1) {
        assert.ok(messages[i - 1].createdAt.getTime() <= messages[i].createdAt.getTime());
      }
    });

    await test("ownership enforced: a stranger cannot load another user's conversation history", async () => {
      await assert.rejects(
        () => service.getMessages(conversation.id, stranger.id),
        EntityNotFoundError,
      );
    });

    await test("an unknown conversationId is rejected the same way as a foreign one (no existence leak)", async () => {
      await assert.rejects(
        () => service.getMessages("does-not-exist", owner.id),
        EntityNotFoundError,
      );
    });
  } finally {
    await prisma.conversation.deleteMany({ where: { id: { in: [conversation.id, emptyConversation.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });

    const leftover = await prisma.message.count({
      where: { OR: [{ conversationId: conversation.id }, { conversationId: emptyConversation.id }] },
    });
    if (leftover > 0) {
      console.error(`  WARNING: ${leftover} message row(s) were not cleaned up`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (users, conversations, messages)");
    }
  }
}

// ---------------------------------------------------------------------------
// Part 2: client side (Node/no-window -> in-memory storage fallback, fetch stubbed)
// ---------------------------------------------------------------------------
function installFetchMock(impl: (url: string) => { ok: boolean; body: unknown }): void {
  globalThis.fetch = (async (url: unknown) => {
    const { ok, body } = impl(String(url));
    return { ok, json: async () => body } as Response;
  }) as typeof fetch;
}

function installThrowingFetchMock(): void {
  globalThis.fetch = (async () => {
    throw new Error("simulated network failure");
  }) as typeof fetch;
}

async function runClientTests(): Promise<void> {
  const originalFetch = globalThis.fetch;

  try {
    await test("loadServerMessages returns the messages array on a successful response", async () => {
      const serverMessages: Message[] = [msg("user", "hello", 1), msg("assistant", "hi there", 2)];
      installFetchMock(() => ({
        ok: true,
        body: { status: "ok", data: { conversationId: "srv-1", messages: serverMessages, count: 2 } },
      }));
      const result = await loadServerMessages("srv-1");
      assert.deepEqual(result, serverMessages);
    });

    await test("loadServerMessages never throws on a network failure - resolves to []", async () => {
      installThrowingFetchMock();
      const result = await loadServerMessages("srv-network-down");
      assert.deepEqual(result, []);
    });

    await test("loadServerMessages never throws on a 404 (unowned/nonexistent) - resolves to []", async () => {
      installFetchMock(() => ({ ok: false, body: { status: "error", error: { code: "NOT_FOUND", message: "Conversation not found" } } }));
      const result = await loadServerMessages("srv-not-mine");
      assert.deepEqual(result, []);
    });

    await test("hydrateFromServer fills in an empty local conversation with server messages", async () => {
      const conv = await mgr.setServerConversationId(await mgr.createConversation("Empty local"), "srv-2");
      assert.equal(conv.messages.length, 0);

      const serverMessages: Message[] = [msg("user", "restored q", 10), msg("assistant", "restored a", 11)];
      const hydrated = await mgr.hydrateFromServer(conv, serverMessages);
      assert.deepEqual(hydrated.messages, serverMessages);

      const reloaded = (await mgr.loadRecent()).find((c) => c.id === conv.id);
      assert.deepEqual(reloaded?.messages, serverMessages, "hydration must be persisted, not just returned");
    });

    await test("hydrateFromServer never overwrites a conversation that already has local messages", async () => {
      const existing = msg("user", "already typed this locally", 20);
      let conv: StoredConversation = await mgr.createConversation("Has local messages");
      conv = await mgr.addMessage(conv, existing);

      const serverMessages: Message[] = [msg("user", "different server history", 21)];
      const result = await mgr.hydrateFromServer(conv, serverMessages);

      assert.deepEqual(result.messages, [existing], "local messages must win; server data must not clobber them");
    });

    await test("hydrateFromServer is a no-op when the server has nothing to offer", async () => {
      const conv = await mgr.setServerConversationId(await mgr.createConversation("Nothing on server yet"), "srv-3");
      const result = await mgr.hydrateFromServer(conv, []);
      assert.deepEqual(result.messages, []);
      assert.equal(result.id, conv.id);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  await runServerTests();
  await runClientTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
