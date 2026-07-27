// scripts/validate-conversation-sync-propagation.ts
// Sprint 15C.8 - Standalone validation for propagating local archive/
// unarchive/delete actions to the server (services/ai/assistant.service.ts
// .archiveServerConversation/.deleteServerConversation, wired into
// app/dashboard/assistant/page.tsx's onArchive/onDelete handlers). The
// PATCH/DELETE routes themselves were already validated end-to-end in
// scripts/validate-conversation-lifecycle.ts (15C.7); this script covers
// only the new client-side wiring, via a stubbed fetch (no network, no
// server, no auth needed) - same pattern as
// validate-client-conversation-identity.ts. No test framework exists in
// this project; run via `npm run validate:sync-propagation`.
import assert from "node:assert/strict";
import {
  archiveServerConversation,
  deleteServerConversation,
} from "../services/ai/assistant.service";
import type { StoredConversation } from "../types/conversation-metadata";

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

interface Captured {
  called: boolean;
  url?: string;
  method?: string;
  body?: unknown;
}

function installFetchMock(ok: boolean): Captured {
  const captured: Captured = { called: false };
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.called = true;
    captured.url = String(url);
    captured.method = init?.method ?? "GET";
    captured.body = init?.body ? JSON.parse(init.body as string) : undefined;
    return { ok, json: async () => ({ status: ok ? "ok" : "error" }) } as Response;
  }) as typeof fetch;
  return captured;
}

function installThrowingFetchMock(): void {
  globalThis.fetch = (async () => {
    throw new Error("simulated network failure");
  }) as typeof fetch;
}

// Mirrors app/dashboard/assistant/page.tsx's onArchive/onDelete guards
// exactly: only call the server when the conversation is linked.
function makeConv(serverConversationId?: string): StoredConversation {
  return {
    id: "conv-local-1",
    title: "Test",
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pinned: false,
    archived: false,
    serverConversationId,
  };
}

async function simulateOnArchive(conv: StoredConversation, archived: boolean): Promise<void> {
  if (conv.serverConversationId) {
    await archiveServerConversation(conv.serverConversationId, archived);
  }
}

async function simulateOnDelete(conv: StoredConversation): Promise<void> {
  if (conv.serverConversationId) {
    await deleteServerConversation(conv.serverConversationId);
  }
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;

  try {
    await test("archiving a linked conversation PATCHes the right URL with {archived: true}", async () => {
      const captured = installFetchMock(true);
      const conv = makeConv("srv-abc");
      await simulateOnArchive(conv, true);
      assert.equal(captured.called, true);
      assert.equal(captured.url, "/api/private/conversations/srv-abc");
      assert.equal(captured.method, "PATCH");
      assert.deepEqual(captured.body, { archived: true });
    });

    await test("unarchiving a linked conversation PATCHes {archived: false}", async () => {
      const captured = installFetchMock(true);
      const conv = makeConv("srv-abc");
      await simulateOnArchive(conv, false);
      assert.deepEqual(captured.body, { archived: false });
    });

    await test("deleting a linked conversation DELETEs the right URL", async () => {
      const captured = installFetchMock(true);
      const conv = makeConv("srv-xyz");
      await simulateOnDelete(conv);
      assert.equal(captured.called, true);
      assert.equal(captured.url, "/api/private/conversations/srv-xyz");
      assert.equal(captured.method, "DELETE");
    });

    await test("archiving a conversation with no serverConversationId never calls fetch (legacy/local-only)", async () => {
      const captured = installFetchMock(true);
      const conv = makeConv(undefined);
      await simulateOnArchive(conv, true);
      assert.equal(captured.called, false, "a purely local conversation must never hit the network");
    });

    await test("deleting a conversation with no serverConversationId never calls fetch (legacy/local-only)", async () => {
      const captured = installFetchMock(true);
      const conv = makeConv(undefined);
      await simulateOnDelete(conv);
      assert.equal(captured.called, false);
    });

    await test("archiveServerConversation never throws on a network failure - resolves to false", async () => {
      installThrowingFetchMock();
      const result = await archiveServerConversation("srv-down", true);
      assert.equal(result, false);
    });

    await test("deleteServerConversation never throws on a network failure - resolves to false", async () => {
      installThrowingFetchMock();
      const result = await deleteServerConversation("srv-down");
      assert.equal(result, false);
    });

    await test("archiveServerConversation resolves to false on a non-ok response (e.g. foreign/nonexistent conversation)", async () => {
      installFetchMock(false);
      const result = await archiveServerConversation("srv-not-mine", true);
      assert.equal(result, false);
    });

    await test("deleteServerConversation resolves to false on a non-ok response", async () => {
      installFetchMock(false);
      const result = await deleteServerConversation("srv-not-mine");
      assert.equal(result, false);
    });

    await test("archiveServerConversation resolves to true on a successful response", async () => {
      installFetchMock(true);
      const result = await archiveServerConversation("srv-ok", true);
      assert.equal(result, true);
    });

    await test("deleteServerConversation resolves to true on a successful response", async () => {
      installFetchMock(true);
      const result = await deleteServerConversation("srv-ok");
      assert.equal(result, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
