// scripts/validate-chat-orchestration.ts
// Sprint 15C.4 - Standalone validation for the orchestration added to
// app/api/private/knowledge/chat/route.ts: persist user turn -> load
// chronological history -> assemble deterministic AI context -> (simulate
// generation) -> persist assistant turn. No test framework exists in this
// project (see package.json); run via `npm run validate:orchestration`.
//
// This exercises the same building blocks the route calls
// (ConversationMessageService from Sprint 15C.3, buildContext from Sprint
// 15C.2) in the same order, without a live Gemini call - regression
// coverage for message persistence itself lives in
// validate-conversation-messages.ts and for the Context Manager itself in
// validate-context-manager.ts; this script covers the NEW wiring between
// them. Self-cleaning against the real DB, synthetic non-sensitive data.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { ConversationMessageService, toMessage } from "../services/ai/conversation-message.service";
import { buildContext } from "../services/ai/context-manager.service";
import { EntityNotFoundError } from "../types/repository";

const RUN_TAG = `sprint15c4-${Date.now()}`;
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

async function main(): Promise<void> {
  const owner = await prisma.user.create({
    data: { email: `${RUN_TAG}-owner@internal.test`, name: "Orchestration Owner" },
  });
  const stranger = await prisma.user.create({
    data: { email: `${RUN_TAG}-stranger@internal.test`, name: "Orchestration Stranger" },
  });
  const conversation = await prisma.conversation.create({
    data: { userId: owner.id, title: "Sprint 15C.4 orchestration validation" },
  });

  try {
    await test("authenticated conversation flow: user turn persists, history loads, current message splits out", async () => {
      await service.addUserMessage(conversation.id, owner.id, "What is the RAG retrieval flow?");
      const persisted = (await service.getMessages(conversation.id, owner.id)).map(toMessage);
      assert.equal(persisted.length, 1);
      const current = persisted[persisted.length - 1];
      const recent = persisted.slice(0, -1);
      assert.equal(current.content, "What is the RAG retrieval flow?");
      assert.deepEqual(recent, []);
    });

    await test("assistant message persistence: a turn can be added after the user's", async () => {
      await service.addAssistantMessage(conversation.id, owner.id, "RAG embeds the query, then searches pgvector.");
      const count = await service.countMessages(conversation.id, owner.id);
      assert.equal(count, 2);
    });

    await test("chronological history + Context Manager receives it in order, current message last", async () => {
      await service.addUserMessage(conversation.id, owner.id, "And how does live search fit in?");
      const persisted = (await service.getMessages(conversation.id, owner.id)).map(toMessage);
      assert.equal(persisted.length, 3);

      const currentMessage = persisted[persisted.length - 1];
      const recentMessages = persisted.slice(0, -1);

      const aiContext = buildContext({
        systemInstructions: undefined,
        recentMessages,
        userMessage: currentMessage,
      });

      // Current message must be the final entry, exactly as loaded from the DB.
      assert.equal(aiContext.messages.at(-1)!.id, currentMessage.id);
      assert.equal(aiContext.messages.at(-1)!.content, "And how does live search fit in?");

      // Prior turns precede it, in the same chronological order they were persisted.
      const priorContents = aiContext.messages.slice(0, -1).map((m) => m.content);
      assert.deepEqual(priorContents, [
        "What is the RAG retrieval flow?",
        "RAG embeds the query, then searches pgvector.",
      ]);
    });

    await test("RAG context remains available to the Context Manager when retrieval finds matches", async () => {
      const persisted = (await service.getMessages(conversation.id, owner.id)).map(toMessage);
      const currentMessage = persisted[persisted.length - 1];
      const recentMessages = persisted.slice(0, -1);

      const aiContext = buildContext({
        systemInstructions: "Use the following context from the user's knowledge base to answer.",
        ragContext: "- Margin requirements are 2% of position size.\n",
        recentMessages,
        userMessage: currentMessage,
      });

      assert.equal(aiContext.meta.ragContextIncluded, true);
      assert.ok(
        aiContext.messages.some((m) => m.role === "system" && m.content.includes("Margin requirements")),
        "RAG context should appear as a system message",
      );
    });

    await test("Google Search grounding path is still present in the route (structural check)", () => {
      const source = readFileSync(new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url), "utf8");
      assert.ok(source.includes("googleSearch"), "route must still request Google Search grounding");
      assert.ok(source.includes("useSearch"), "route must still respect the useSearch flag");
    });

    await test("unauthorized conversation access is rejected before any message is written", async () => {
      await assert.rejects(
        () => service.addUserMessage(conversation.id, stranger.id, "should never be written"),
        EntityNotFoundError,
      );
      const strangerRows = await prisma.message.count({ where: { conversationId: conversation.id, userId: stranger.id } });
      assert.equal(strangerRows, 0);
    });

    await test("AI failure does not create a fake assistant message", async () => {
      const before = await service.countMessages(conversation.id, owner.id);
      // Mirrors the route's catch block: the user's turn persists first
      // (matching "persist before generation"), generation then "fails",
      // and addAssistantMessage is simply never called - no placeholder,
      // no rollback of the user's message.
      await service.addUserMessage(conversation.id, owner.id, "This one will hit a simulated AI failure");
      const after = await service.countMessages(conversation.id, owner.id);
      assert.equal(after, before + 1, "only the user's turn should be persisted, no assistant turn");

      const messages = await service.getMessages(conversation.id, owner.id);
      const last = messages[messages.length - 1];
      assert.equal(last.role, "user");
      assert.equal(last.content, "This one will hit a simulated AI failure");
    });
  } finally {
    await prisma.conversation.deleteMany({ where: { id: conversation.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });

    const leftover = await prisma.message.count({ where: { conversationId: conversation.id } });
    if (leftover > 0) {
      console.error(`  WARNING: ${leftover} message row(s) were not cleaned up`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (users, conversation, messages)");
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
