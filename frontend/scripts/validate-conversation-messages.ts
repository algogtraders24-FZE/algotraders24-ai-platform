// scripts/validate-conversation-messages.ts
// Sprint 15C.3 - Standalone validation for the Message persistence
// foundation (ConversationMessageService + PrismaMessageRepository) against
// the REAL database (no test framework exists in this project - see
// package.json). Run via `npm run validate:messages`.
//
// Safety: creates exactly one throwaway User + two Conversations (owner and
// stranger) under clearly-marked synthetic emails, exercises every case,
// then hard-deletes everything it created in a `finally` block regardless of
// pass/fail. It never reads or touches any pre-existing row. Test data is
// synthetic, non-sensitive placeholder text only.
import "dotenv/config"; // tsx does not auto-load .env the way `next dev`/`prisma` do
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { ConversationMessageService } from "../services/ai/conversation-message.service";
import { EntityNotFoundError, RepositoryError } from "../types/repository";

const RUN_TAG = `sprint15c3-${Date.now()}`;
const service = new ConversationMessageService();

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
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

async function main(): Promise<void> {
  const owner = await prisma.user.create({
    data: { email: `${RUN_TAG}-owner@internal.test`, name: "Validation Owner" },
  });
  const stranger = await prisma.user.create({
    data: { email: `${RUN_TAG}-stranger@internal.test`, name: "Validation Stranger" },
  });
  const conversation = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.3 validation conversation" },
  });
  const emptyConversation = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.3 empty conversation" },
  });

  try {
    await test("message creation: addUserMessage persists a row", async () => {
      const msg = await service.addUserMessage(conversation.id, owner.id, "What is margin?");
      assert.equal(msg.role, "user");
      assert.equal(msg.content, "What is margin?");
      assert.equal(msg.conversationId, conversation.id);
      assert.equal(msg.userId, owner.id);
      assert.ok(msg.id);
    });

    await test("user and assistant roles both persist correctly", async () => {
      const assistantMsg = await service.addAssistantMessage(conversation.id, owner.id, "Margin is collateral.");
      assert.equal(assistantMsg.role, "assistant");
    });

    await test("multiple messages: several turns can be added", async () => {
      await service.addUserMessage(conversation.id, owner.id, "Second question");
      await service.addAssistantMessage(conversation.id, owner.id, "Second answer");
      const count = await service.countMessages(conversation.id, owner.id);
      assert.equal(count, 4); // 2 from earlier tests + these 2
    });

    await test("chronological retrieval: messages come back oldest first", async () => {
      const messages = await service.getMessages(conversation.id, owner.id);
      assert.equal(messages.length, 4);
      for (let i = 1; i < messages.length; i += 1) {
        assert.ok(
          messages[i - 1].createdAt.getTime() <= messages[i].createdAt.getTime(),
          "messages must be non-decreasing in createdAt order",
        );
      }
      assert.deepEqual(
        messages.map((m) => m.content),
        ["What is margin?", "Margin is collateral.", "Second question", "Second answer"],
      );
    });

    await test("deterministic ordering: repeated retrieval returns the same order", async () => {
      const first = await service.getMessages(conversation.id, owner.id);
      const second = await service.getMessages(conversation.id, owner.id);
      assert.deepEqual(first.map((m) => m.id), second.map((m) => m.id));
    });

    await test("empty conversation: getMessages returns an empty array, not an error", async () => {
      const messages = await service.getMessages(emptyConversation.id, owner.id);
      assert.deepEqual(messages, []);
      const count = await service.countMessages(emptyConversation.id, owner.id);
      assert.equal(count, 0);
    });

    await test("conversation ownership: the owner can read their own conversation", async () => {
      const messages = await service.getMessages(conversation.id, owner.id);
      assert.ok(messages.length > 0);
    });

    await test("unauthorized access rejection: a stranger cannot read another user's conversation", async () => {
      await assert.rejects(
        () => service.getMessages(conversation.id, stranger.id),
        EntityNotFoundError,
      );
    });

    await test("unauthorized access rejection: a stranger cannot write into another user's conversation", async () => {
      await assert.rejects(
        () => service.addUserMessage(conversation.id, stranger.id, "injected message"),
        EntityNotFoundError,
      );
      // Confirm nothing was actually written under the stranger's id.
      const strangerCount = await prisma.message.count({ where: { conversationId: conversation.id, userId: stranger.id } });
      assert.equal(strangerCount, 0);
    });

    await test("unknown conversationId is rejected the same way as a foreign one (no existence leak)", async () => {
      await assert.rejects(
        () => service.getMessages("does-not-exist", owner.id),
        EntityNotFoundError,
      );
    });

    await test("invalid message role is rejected", async () => {
      await assert.rejects(
        () =>
          service.addMessage({
            conversationId: conversation.id,
            userId: owner.id,
            // @ts-expect-error intentionally invalid role for validation testing
            role: "system",
            content: "should not be allowed",
          }),
        RepositoryError,
      );
    });

    await test("empty content is rejected", async () => {
      await assert.rejects(
        () => service.addUserMessage(conversation.id, owner.id, "   "),
        RepositoryError,
      );
    });

    await test("empty conversationId is rejected", async () => {
      await assert.rejects(
        () => service.addUserMessage("", owner.id, "hello"),
        RepositoryError,
      );
    });
  } finally {
    // Cascade deletes Message rows via the Conversation FK (onDelete: Cascade).
    await prisma.conversation.deleteMany({ where: { id: { in: [conversation.id, emptyConversation.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });

    const leftoverMessages = await prisma.message.count({
      where: { OR: [{ conversationId: conversation.id }, { conversationId: emptyConversation.id }] },
    });
    if (leftoverMessages > 0) {
      console.error(`  WARNING: ${leftoverMessages} message row(s) were not cleaned up`);
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
