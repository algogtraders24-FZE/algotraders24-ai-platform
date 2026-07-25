// scripts/validate-conversation-lifecycle.ts
// Sprint 15C.7 - Standalone validation for conversation lifecycle
// (archive/unarchive/soft-delete): services/ai/conversation-lifecycle
// .service.ts (ConversationService), services/ai/conversation-ownership
// .service.ts (the shared ownership helper), and the repository wiring for
// Conversation.archived. Exercises the exact functions the new PATCH/DELETE
// route calls - see app/api/private/conversations/[conversationId]/route.ts.
// No test framework exists in this project; run via
// `npm run validate:lifecycle`. Self-cleaning against the real DB,
// synthetic sprint15c7-tagged data only.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { RepositoryFactory } from "../repositories/RepositoryFactory";
import { ConversationService } from "../services/ai/conversation-lifecycle.service";
import { ConversationMessageService } from "../services/ai/conversation-message.service";
import { EntityNotFoundError } from "../types/repository";

const RUN_TAG = `sprint15c7-${Date.now()}`;
const lifecycle = new ConversationService();
const messages = new ConversationMessageService();

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

async function rawConversation(id: string) {
  return prisma.conversation.findUnique({ where: { id } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.create({
    data: { email: `${RUN_TAG}-owner@internal.test`, name: "Lifecycle Owner" },
  });
  const stranger = await prisma.user.create({
    data: { email: `${RUN_TAG}-stranger@internal.test`, name: "Lifecycle Stranger" },
  });

  const convArchive = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.7 archive/unarchive target" },
  });
  const convDelete = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.7 soft-delete target" },
  });
  const convGuard = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.7 foreign-delete guard" },
  });
  const convFresh = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.7 regression sanity" },
  });

  try {
    // ---- 1/2: owner can archive; state persists ----
    await test("owner can archive own conversation", async () => {
      await lifecycle.archiveConversation(convArchive.id, owner.id);
    });
    await test("archived state persists in the database", async () => {
      const row = await rawConversation(convArchive.id);
      assert.equal(row?.archived, true);
    });

    // ---- 5/6: foreign user cannot archive / unarchive, no mutation ----
    await test("foreign user cannot archive (already-archived) conversation", async () => {
      await assert.rejects(
        () => lifecycle.archiveConversation(convArchive.id, stranger.id),
        EntityNotFoundError,
      );
    });
    await test("foreign user cannot unarchive another user's conversation", async () => {
      await assert.rejects(
        () => lifecycle.unarchiveConversation(convArchive.id, stranger.id),
        EntityNotFoundError,
      );
      const row = await rawConversation(convArchive.id);
      assert.equal(row?.archived, true, "a rejected foreign mutation must not have changed anything");
    });

    // ---- 3: owner can unarchive ----
    await test("owner can unarchive own conversation", async () => {
      await lifecycle.unarchiveConversation(convArchive.id, owner.id);
      const row = await rawConversation(convArchive.id);
      assert.equal(row?.archived, false);
    });

    // ---- 10: archived conversation remains in the normal list ----
    await test("archived conversation remains in normal list results", async () => {
      await lifecycle.archiveConversation(convArchive.id, owner.id);
      const list = await RepositoryFactory.conversations().findByUser(owner.id);
      const found = list.find((c) => c.id === convArchive.id);
      assert.ok(found, "archived conversation must still be listed");
      assert.equal(found?.archived, true);
    });

    // ---- 11: messages survive soft-delete at the DB row level ----
    await messages.addUserMessage(convDelete.id, owner.id, "question before delete");
    await messages.addAssistantMessage(convDelete.id, owner.id, "answer before delete");

    // ---- 7: foreign user cannot soft-delete ----
    await test("foreign user cannot soft-delete another user's conversation", async () => {
      await assert.rejects(
        () => lifecycle.softDeleteConversation(convGuard.id, stranger.id),
        EntityNotFoundError,
      );
      const row = await rawConversation(convGuard.id);
      assert.equal(row?.deletedAt, null, "a rejected foreign delete must not have changed anything");
    });

    // ---- 4: owner can soft-delete ----
    await test("owner can soft-delete own conversation", async () => {
      await lifecycle.softDeleteConversation(convDelete.id, owner.id);
      const row = await rawConversation(convDelete.id);
      assert.ok(row, "the row itself must still physically exist");
      assert.ok(row!.deletedAt !== null, "deletedAt must be set");
    });

    await test("messages survive soft-delete at the DB row level (not cascaded)", async () => {
      const rows = await prisma.message.findMany({ where: { conversationId: convDelete.id } });
      assert.equal(rows.length, 2, "soft-deleting the conversation must not touch its messages");
      assert.ok(rows.every((r) => r.deletedAt === null));
    });

    // ---- 12: deleted conversation becomes unreachable via the message service ----
    await test("deleted conversation is unreachable through ConversationMessageService", async () => {
      await assert.rejects(
        () => messages.getMessages(convDelete.id, owner.id),
        EntityNotFoundError,
      );
    });

    // ---- 9: deleted conversation excluded from normal list ----
    await test("deleted conversation is excluded from normal list results", async () => {
      const list = await RepositoryFactory.conversations().findByUser(owner.id);
      assert.ok(!list.some((c) => c.id === convDelete.id));
    });

    // ---- 8: unknown vs foreign id produce equivalent behavior ----
    await test("an unknown conversationId behaves the same as a foreign one", async () => {
      let unknownError: unknown;
      let foreignError: unknown;
      try {
        await lifecycle.archiveConversation("does-not-exist", owner.id);
      } catch (e) {
        unknownError = e;
      }
      try {
        await lifecycle.archiveConversation(convDelete.id, stranger.id); // now soft-deleted too
      } catch (e) {
        foreignError = e;
      }
      assert.ok(unknownError instanceof EntityNotFoundError);
      assert.ok(foreignError instanceof EntityNotFoundError);
      assert.equal((unknownError as Error).message.includes("not found"), true);
      assert.equal((foreignError as Error).message.includes("not found"), true);
    });

    // ---- 13: consolidated "no unauthorized mutation occurs" ----
    await test("no unauthorized mutation occurred across the whole run (final state check)", async () => {
      const guardRow = await rawConversation(convGuard.id);
      assert.equal(guardRow?.deletedAt, null);
      assert.equal(guardRow?.archived, false);
    });

    // ---- 14: existing message behavior remains intact after the refactor ----
    await test("existing message behavior (chronological order) remains intact", async () => {
      await messages.addUserMessage(convFresh.id, owner.id, "first");
      await messages.addAssistantMessage(convFresh.id, owner.id, "second");
      const history = await messages.getMessages(convFresh.id, owner.id);
      assert.deepEqual(history.map((m) => m.content), ["first", "second"]);
    });
  } finally {
    await prisma.conversation.deleteMany({
      where: { id: { in: [convArchive.id, convDelete.id, convGuard.id, convFresh.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });

    const leftoverMessages = await prisma.message.count({
      where: { conversationId: { in: [convArchive.id, convDelete.id, convGuard.id, convFresh.id] } },
    });
    const leftoverConversations = await prisma.conversation.count({
      where: { id: { in: [convArchive.id, convDelete.id, convGuard.id, convFresh.id] } },
    });
    const leftoverUsers = await prisma.user.count({ where: { id: { in: [owner.id, stranger.id] } } });

    if (leftoverMessages > 0 || leftoverConversations > 0 || leftoverUsers > 0) {
      console.error(
        `  WARNING: leftover rows - messages:${leftoverMessages} conversations:${leftoverConversations} users:${leftoverUsers}`,
      );
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (users, conversations, messages)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
