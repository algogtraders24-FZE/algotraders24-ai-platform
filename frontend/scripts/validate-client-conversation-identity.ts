// scripts/validate-client-conversation-identity.ts
// Sprint 15C.5 - Standalone validation for the assistant client's new
// server-conversation-id state handling (services/ai/assistant.service.ts,
// services/ai/conversation-manager.service.ts, types/assistant.ts,
// types/conversation-metadata.ts). No test framework exists in this project
// (see package.json); run via `npm run validate:client-conversation`.
//
// Runs under plain Node (tsx), no browser: services/storage/local-storage.ts
// falls back to services/storage/memory-storage.ts whenever `window` is
// undefined, so conversation-manager.service.ts's persistence works exactly
// as it does in the browser, just backed by an in-memory Map instead of
// localStorage. `fetch` is stubbed (no network, no server, no auth needed)
// so the REAL assistant.service.ts.sendMessage() is exercised, not a
// reimplementation of it.
import assert from "node:assert/strict";
import * as mgr from "../services/ai/conversation-manager.service";
import * as repo from "../services/ai/conversation.repository";
import { sendMessage } from "../services/ai/assistant.service";
import type { AssistantResponse } from "../types/assistant";
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
  url?: string;
  body?: Record<string, unknown>;
}

function installFetchMock(responseBody: unknown, ok = true): Captured {
  const captured: Captured = {};
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.url = String(url);
    captured.body = init?.body ? JSON.parse(init.body as string) : undefined;
    return {
      ok,
      json: async () => responseBody,
    } as Response;
  }) as typeof fetch;
  return captured;
}

// Mirrors app/dashboard/assistant/page.tsx's handleSend logic exactly, so
// this script validates the same state transition the UI performs, without
// needing a DOM/React renderer.
async function simulateSend(
  conv: StoredConversation,
  text: string,
  res: AssistantResponse,
): Promise<StoredConversation> {
  let updated = conv;
  if (res.serverConversationId && res.serverConversationId !== updated.serverConversationId) {
    updated = await mgr.setServerConversationId(updated, res.serverConversationId);
  }
  return updated;
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;

  try {
    await test("first successful response stores serverConversationId on the active conversation", async () => {
      const conv = await mgr.createConversation("Test chat");
      installFetchMock({
        status: "ok",
        data: { content: "Hello!", ragApplied: false, sourcesCount: 0, conversationId: "srv-123" },
      });
      const res = await sendMessage({ conversationId: conv.id, message: "hi", serverConversationId: conv.serverConversationId });
      assert.equal(res.serverConversationId, "srv-123");

      const updated = await simulateSend(conv, "hi", res);
      assert.equal(updated.serverConversationId, "srv-123");

      const reloaded = (await mgr.loadRecent()).find((c) => c.id === conv.id);
      assert.equal(reloaded?.serverConversationId, "srv-123", "must be persisted, not just held in a local variable");
    });

    await test("second request in the same conversation sends the stored serverConversationId", async () => {
      const conv = await mgr.createConversation("Test chat 2");
      const linked = await mgr.setServerConversationId(conv, "srv-456");

      const captured = installFetchMock({
        status: "ok",
        data: { content: "Second reply", ragApplied: false, sourcesCount: 0, conversationId: "srv-456" },
      });
      await sendMessage({ conversationId: linked.id, message: "follow up", serverConversationId: linked.serverConversationId });

      assert.equal(captured.body?.conversationId, "srv-456");
      assert.equal(captured.body?.query, "follow up");
    });

    await test("callers without a serverConversationId (publishing/trading-copilot/agents) never send one", async () => {
      const captured = installFetchMock({
        status: "ok",
        data: { content: "ok", ragApplied: false, sourcesCount: 0, conversationId: "srv-should-be-ignored-by-caller" },
      });
      // Mirrors app/dashboard/publishing/page.tsx: conversationId is a local
      // label only, serverConversationId is never set by that caller.
      await sendMessage({ conversationId: "publishing", message: "generate an article" });
      assert.equal(
        Object.prototype.hasOwnProperty.call(captured.body ?? {}, "conversationId"),
        false,
        "conversationId must be omitted from the request body, not sent as the local label",
      );
    });

    await test("new conversation starts with no serverConversationId (clears any previous link)", async () => {
      const linked = await mgr.setServerConversationId(await mgr.createConversation("Old chat"), "srv-old");
      assert.equal(linked.serverConversationId, "srv-old");

      const fresh = await mgr.createConversation("New chat");
      assert.equal(fresh.serverConversationId, undefined, "a brand-new conversation must not inherit any previous server id");
    });

    await test("a response missing conversationId does not crash the client and leaves the link unset", async () => {
      const conv = await mgr.createConversation("No id yet");
      installFetchMock({
        status: "ok",
        data: { content: "Reply without a conversationId field", ragApplied: false, sourcesCount: 0 },
      });
      const res = await sendMessage({ conversationId: conv.id, message: "hi", serverConversationId: conv.serverConversationId });
      assert.equal(res.serverConversationId, undefined);

      const updated = await simulateSend(conv, "hi", res);
      assert.equal(updated.serverConversationId, undefined);
    });

    await test("legacy localStorage conversations (no serverConversationId field at all) remain usable", async () => {
      const legacy = {
        id: "conv-legacy-1",
        title: "Pre-15C.5 conversation",
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pinned: false,
        archived: false,
        // deliberately no `serverConversationId` key, simulating JSON saved
        // by the client before this sprint
      } as StoredConversation;
      await repo.save(legacy);

      const loaded = (await mgr.loadRecent()).find((c) => c.id === "conv-legacy-1");
      assert.ok(loaded, "legacy conversation must still load");
      assert.equal(loaded!.serverConversationId, undefined, "must not fabricate an id");

      // First message from a legacy conversation creates a new server one.
      const captured = installFetchMock({
        status: "ok",
        data: { content: "First real reply", ragApplied: false, sourcesCount: 0, conversationId: "srv-new-for-legacy" },
      });
      const res = await sendMessage({ conversationId: loaded!.id, message: "hello", serverConversationId: loaded!.serverConversationId });
      assert.equal(
        Object.prototype.hasOwnProperty.call(captured.body ?? {}, "conversationId"),
        false,
        "no conversationId should be sent for a still-unlinked legacy conversation",
      );
      const linked = await simulateSend(loaded!, "hello", res);
      assert.equal(linked.serverConversationId, "srv-new-for-legacy");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
