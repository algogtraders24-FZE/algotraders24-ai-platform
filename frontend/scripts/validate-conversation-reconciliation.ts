// scripts/validate-conversation-reconciliation.ts
// Sprint 15C.9 - Standalone validation for server conversation discovery
// and reconciliation (services/ai/conversation-manager.service.ts
// .reconcileServerConversations, wired into
// app/dashboard/assistant/page.tsx's mount effect). No test framework
// exists in this project; run via `npm run validate:reconciliation`.
//
// Sprint D2.3.S2 - reconcileServerConversations no longer takes a
// message-fetcher and no longer fetches anything: it was sequentially
// awaiting a full message-history fetch for every unknown server
// conversation on every Assistant page mount (Master Audit D2.3.F: up to
// 28s per conversation). It now creates local stubs with messages: []
// from data already in the server list, and the existing hydrateFromServer
// effect in page.tsx lazy-loads real content only when a conversation is
// actually selected. Part 1's assertions below were updated to match: they
// check identity/ownership/idempotency, not message content, since content
// is no longer part of what reconciliation itself produces.
//
// Part 1 runs under plain Node (tsx), no browser, no fetch mocking needed:
// services/storage/local-storage.ts falls back to an in-memory Map
// whenever `window` is undefined (same mechanism validate-client
// -conversation-identity.ts relies on) - the real function is exercised
// directly with synthetic data, no stubbing required.
//
// Part 2 is one DB-backed, self-cleaning check (real Postgres) confirming
// unauthorized access to the underlying routes' service layer is
// unaffected by this sprint (case 12).
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as mgr from "../services/ai/conversation-manager.service";
import * as repo from "../services/ai/conversation.repository";
import type { ConversationListItem } from "../services/api/ConversationsApi";
import type { Message } from "../types/message";
import { prisma } from "../lib/prisma";
import { ConversationMessageService } from "../services/ai/conversation-message.service";
import { EntityNotFoundError } from "../types/repository";

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

function serverConv(overrides: Partial<ConversationListItem> & { id: string }): ConversationListItem {
  return {
    title: "Untitled",
    messageCount: 0,
    lastMessageAt: new Date().toISOString(),
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function msg(role: Message["role"], content: string, atMs: number): Message {
  return { id: `t-${atMs}`, role, content, createdAt: new Date(atMs).toISOString() };
}

async function wipeLocal(): Promise<void> {
  const all = await mgr.loadRecent();
  for (const c of all) await repo.remove(c.id);
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Part 1: reconciliation algorithm (pure local, in-memory storage)
  // ---------------------------------------------------------------------

  await test("1/4: empty localStorage + server conversations -> all recovered as unfetched stubs", async () => {
    await wipeLocal();
    const serverList = [serverConv({ id: "srv-1", title: "First" }), serverConv({ id: "srv-2", title: "Second" })];

    const recovered = await mgr.reconcileServerConversations(serverList);
    assert.equal(recovered.length, 2);
    const local = await mgr.loadRecent();
    assert.equal(local.length, 2);
    // Sprint D2.3.S2 - messages are intentionally NOT fetched during
    // reconciliation; they lazy-load on selection instead (see
    // hydrateFromServer + page.tsx). A stub with real identity but no
    // content yet is the correct, fast outcome here.
    assert.ok(local.some((c) => c.serverConversationId === "srv-1" && c.messages.length === 0));
    assert.ok(local.some((c) => c.serverConversationId === "srv-2" && c.messages.length === 0));
  });

  await test("2/10: an already-linked local conversation is never duplicated or replaced", async () => {
    await wipeLocal();
    const linked = await mgr.setServerConversationId(await mgr.createConversation("Mine"), "srv-A");
    const withMessage = await mgr.addMessage(linked, msg("user", "already have this", 5));

    const serverList = [serverConv({ id: "srv-A", title: "Server-side title drifted", updatedAt: "2099-01-01T00:00:00.000Z" })];

    const recovered = await mgr.reconcileServerConversations(serverList);
    assert.equal(recovered.length, 0);

    const local = await mgr.loadRecent();
    const stillThere = local.find((c) => c.serverConversationId === "srv-A");
    assert.equal(local.length, 1, "no duplicate should be created");
    assert.equal(stillThere?.id, withMessage.id);
    assert.equal(stillThere?.title, "Mine", "local title must not be overwritten by server drift");
    assert.deepEqual(stillThere?.messages, withMessage.messages, "local messages must be untouched");
  });

  await test("3: a local-only unsynced conversation (no serverConversationId) is preserved untouched", async () => {
    await wipeLocal();
    const unsynced = await mgr.addMessage(await mgr.createConversation("Draft"), msg("user", "never sent", 9));

    const serverList = [serverConv({ id: "srv-unrelated", title: "Something else entirely" })];
    await mgr.reconcileServerConversations(serverList);

    const local = await mgr.loadRecent();
    const stillThere = local.find((c) => c.id === unsynced.id);
    assert.ok(stillThere, "the unsynced local conversation must still exist");
    assert.equal(stillThere?.serverConversationId, undefined, "must never be silently linked to an unrelated server conversation");
    assert.deepEqual(stillThere?.messages, unsynced.messages);
  });

  await test("5/6: localStorage loss then a second 'device' both recover the same server identity", async () => {
    await wipeLocal();
    const serverList = [serverConv({ id: "srv-cross-device", title: "Cross-device chat" })];

    // "Device 1": fresh empty storage recovers it.
    const firstRun = await mgr.reconcileServerConversations(serverList);
    assert.equal(firstRun.length, 1);
    assert.equal(firstRun[0].serverConversationId, "srv-cross-device");

    // Simulate a second device: wipe local storage again, reconcile again.
    await wipeLocal();
    const secondRun = await mgr.reconcileServerConversations(serverList);
    assert.equal(secondRun.length, 1);
    assert.equal(
      secondRun[0].serverConversationId,
      firstRun[0].serverConversationId,
      "the same server conversation must recover to the same serverConversationId on a different device",
    );
  });

  await test("7: an archived server conversation is recovered and marked archived locally", async () => {
    await wipeLocal();
    const serverList = [serverConv({ id: "srv-archived", title: "Old chat", archived: true })];
    const recovered = await mgr.reconcileServerConversations(serverList);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].archived, true);
  });

  await test("8: a soft-deleted conversation is never recovered (it is simply absent from the input)", async () => {
    await wipeLocal();
    // GET /api/private/conversations already excludes deletedAt != null rows
    // (see repositories/PrismaConversationRepository.ts's findByUser), so a
    // deleted conversation never appears in the list this function receives.
    const serverList = [serverConv({ id: "srv-active-only", title: "Still active" })];
    const recovered = await mgr.reconcileServerConversations(serverList);
    assert.equal(recovered.length, 1);
    assert.ok(!recovered.some((c) => c.serverConversationId === "srv-deleted-and-absent"));
  });

  await test("8b: the list route's query still filters deletedAt (structural regression check)", () => {
    const source = readFileSync(new URL("../repositories/PrismaConversationRepository.ts", import.meta.url), "utf8");
    assert.ok(source.includes("deletedAt: null"), "findByUser must still exclude soft-deleted conversations");
  });

  await test("9: reconciliation is idempotent - running it twice creates nothing new the second time", async () => {
    await wipeLocal();
    const serverList = [serverConv({ id: "srv-idempotent" })];

    const first = await mgr.reconcileServerConversations(serverList);
    assert.equal(first.length, 1);
    const second = await mgr.reconcileServerConversations(serverList);
    assert.equal(second.length, 0, "second run must recover nothing - already known");

    const local = await mgr.loadRecent();
    assert.equal(local.filter((c) => c.serverConversationId === "srv-idempotent").length, 1);
  });

  await test("11: reconciliation never sends or requires a userId (structural check)", () => {
    const source = readFileSync(
      new URL("../services/ai/conversation-manager.service.ts", import.meta.url),
      "utf8",
    );
    const fnStart = source.indexOf("export async function reconcileServerConversations");
    const fnSource = source.slice(fnStart, fnStart + 1800);
    assert.ok(!/userId/i.test(fnSource), "reconcileServerConversations must not reference userId at all");
  });

  // ---------------------------------------------------------------------
  // Part 2: DB-backed re-confirmation (case 12 - unauthorized access)
  // ---------------------------------------------------------------------
  const RUN_TAG = `sprint15c9-${Date.now()}`;
  const owner = await prisma.user.create({ data: { email: `${RUN_TAG}-owner@internal.test`, name: "Reconciliation Owner" } });
  const stranger = await prisma.user.create({ data: { email: `${RUN_TAG}-stranger@internal.test`, name: "Reconciliation Stranger" } });
  const conversation = await prisma.conversation.create({ data: { userId: owner.id, title: "Sprint 15C.9 ownership re-check" } });

  try {
    await test("12: unauthorized server access remains rejected (the routes reconciliation depends on)", async () => {
      const messages = new ConversationMessageService();
      await assert.rejects(
        () => messages.getMessages(conversation.id, stranger.id),
        EntityNotFoundError,
      );
    });
  } finally {
    await prisma.conversation.deleteMany({ where: { id: conversation.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    const leftover = await prisma.message.count({ where: { conversationId: conversation.id } });
    if (leftover > 0) {
      console.error(`  WARNING: ${leftover} message row(s) were not cleaned up`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (users, conversation)");
    }
  }

  await wipeLocal();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
