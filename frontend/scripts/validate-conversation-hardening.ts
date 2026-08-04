// scripts/validate-conversation-hardening.ts
// Sprint 15C.10 - Conversation system hardening & completion audit.
// This does NOT re-test what the eight prior scripts already cover
// individually (see validate-context-manager.ts, validate-conversation
// -messages.ts, validate-chat-orchestration.ts, validate-client
// -conversation-identity.ts, validate-conversation-history-sync.ts,
// validate-conversation-lifecycle.ts, validate-conversation-sync
// -propagation.ts, validate-conversation-reconciliation.ts - all still
// green, run separately). Instead it exercises the FULL lifecycle chain as
// one continuous flow against REAL data (not synthetic fixtures), and adds
// two categories no prior script covered:
//   - cross-user reconciliation scoping (does recovery for user A ever see
//     user B's conversations, using the real findByUser output)
//   - a structural sweep across every conversation-related route
//     confirming none of them ever read userId from the request body
// No test framework exists in this project; run via
// `npm run validate:hardening`. Self-cleaning against the real DB,
// synthetic sprint15c10-tagged data only.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { RepositoryFactory } from "../repositories/RepositoryFactory";
import { ConversationMessageService } from "../services/ai/conversation-message.service";
import { ConversationService } from "../services/ai/conversation-lifecycle.service";
import { reconcileServerConversations, loadRecent } from "../services/ai/conversation-manager.service";
import { EntityNotFoundError } from "../types/repository";

const RUN_TAG = `sprint15c10-${Date.now()}`;
const messages = new ConversationMessageService();
const lifecycle = new ConversationService();

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

function routeSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function main(): Promise<void> {
  const userA = await prisma.user.create({ data: { email: `${RUN_TAG}-a@internal.test`, name: "Hardening User A" } });
  const userB = await prisma.user.create({ data: { email: `${RUN_TAG}-b@internal.test`, name: "Hardening User B" } });

  const convA = await RepositoryFactory.conversations().create({
    userId: userA.id,
    title: "Sprint 15C.10 full-chain conversation",
    messageCount: 0,
    lastMessageAt: new Date().toISOString(),
  });
  const convASecond = await RepositoryFactory.conversations().create({
    userId: userA.id,
    title: "Sprint 15C.10 second A conversation (stays active)",
    messageCount: 0,
    lastMessageAt: new Date().toISOString(),
  });
  const convB = await RepositoryFactory.conversations().create({
    userId: userB.id,
    title: "Sprint 15C.10 user B conversation",
    messageCount: 0,
    lastMessageAt: new Date().toISOString(),
  });

  try {
    // -----------------------------------------------------------------
    // Part A: full lifecycle chain, one continuous real-data flow
    // -----------------------------------------------------------------
    await test("full chain 1/9: create -> persist user+assistant messages", async () => {
      await messages.addUserMessage(convA.id, userA.id, "What is margin?");
      await messages.addAssistantMessage(convA.id, userA.id, "Margin is collateral.");
      const history = await messages.getMessages(convA.id, userA.id);
      assert.deepEqual(history.map((m) => m.content), ["What is margin?", "Margin is collateral."]);
    });

    await test("full chain 2/9: archive -> real findByUser reflects it, still listed", async () => {
      await lifecycle.archiveConversation(convA.id, userA.id);
      const list = await RepositoryFactory.conversations().findByUser(userA.id);
      const found = list.find((c) => c.id === convA.id);
      assert.ok(found, "archived conversation must remain in the normal list");
      assert.equal(found?.archived, true);
    });

    await test("full chain 3/9: unarchive -> real findByUser reflects it", async () => {
      await lifecycle.unarchiveConversation(convA.id, userA.id);
      const list = await RepositoryFactory.conversations().findByUser(userA.id);
      assert.equal(list.find((c) => c.id === convA.id)?.archived, false);
    });

    await test("full chain 4/9: soft-delete -> excluded from real findByUser", async () => {
      await lifecycle.softDeleteConversation(convA.id, userA.id);
      const list = await RepositoryFactory.conversations().findByUser(userA.id);
      assert.ok(!list.some((c) => c.id === convA.id), "soft-deleted conversation must be excluded from the real list query");
    });

    await test("full chain 5/9: message rows remain physically intact after soft-delete", async () => {
      const rows = await prisma.message.findMany({ where: { conversationId: convA.id } });
      assert.equal(rows.length, 2, "both messages must still exist as rows");
      assert.ok(rows.every((r) => r.deletedAt === null), "messages themselves are not touched by the conversation's soft-delete");
    });

    await test("full chain 6/9: deleted conversation is not recoverable via the message service", async () => {
      await assert.rejects(() => messages.getMessages(convA.id, userA.id), EntityNotFoundError);
    });

    await test("full chain 7/9: one reconciliation pass recovers the still-active conversation but never the deleted one, using the REAL list", async () => {
      const realList = await RepositoryFactory.conversations().findByUser(userA.id);
      assert.ok(!realList.some((c) => c.id === convA.id), "sanity: deleted conversation must not be in the real list fed to reconciliation");
      assert.ok(realList.some((c) => c.id === convASecond.id), "sanity: the still-active conversation must be in the real list");

      const recovered = await reconcileServerConversations(realList);
      assert.ok(!recovered.some((c) => c.serverConversationId === convA.id), "the deleted conversation must never be recovered");
      assert.ok(recovered.some((c) => c.serverConversationId === convASecond.id), "the still-active conversation must be recovered");
    });

    await test("full chain 8/9: reconciliation against the same real list a second time is idempotent (no duplicates)", async () => {
      const realList = await RepositoryFactory.conversations().findByUser(userA.id);
      // The previous test already recovered convASecond; running again
      // against the same real list must recover nothing new at all.
      const secondRun = await reconcileServerConversations(realList);
      assert.equal(secondRun.length, 0, "already-recovered conversation must not be recovered again");
    });

    await test("full chain 9/9: exactly one local record exists for the recovered conversation (no duplicate accumulation)", async () => {
      const local = await loadRecent();
      const matches = local.filter((c) => c.serverConversationId === convASecond.id);
      assert.equal(matches.length, 1, "two reconciliation passes must not have produced two local copies");
    });

    // -----------------------------------------------------------------
    // Part B: security - cross-user isolation and scoping
    // -----------------------------------------------------------------
    await messages.addUserMessage(convB.id, userB.id, "User B's private question");

    await test("security: user A cannot read user B's conversation", async () => {
      await assert.rejects(() => messages.getMessages(convB.id, userA.id), EntityNotFoundError);
    });

    await test("security: user A cannot write to user B's conversation", async () => {
      await assert.rejects(() => messages.addUserMessage(convB.id, userA.id, "injected"), EntityNotFoundError);
      const rows = await prisma.message.count({ where: { conversationId: convB.id, userId: userA.id } });
      assert.equal(rows, 0);
    });

    await test("security: user A cannot archive/unarchive/delete user B's conversation", async () => {
      await assert.rejects(() => lifecycle.archiveConversation(convB.id, userA.id), EntityNotFoundError);
      await assert.rejects(() => lifecycle.unarchiveConversation(convB.id, userA.id), EntityNotFoundError);
      await assert.rejects(() => lifecycle.softDeleteConversation(convB.id, userA.id), EntityNotFoundError);
      const row = await prisma.conversation.findUnique({ where: { id: convB.id } });
      assert.equal(row?.archived, false);
      assert.equal(row?.deletedAt, null);
    });

    await test("security: foreign conversation ID and a nonexistent ID produce equivalent rejection", async () => {
      let foreignErr: unknown;
      let unknownErr: unknown;
      try {
        await messages.getMessages(convB.id, userA.id);
      } catch (e) {
        foreignErr = e;
      }
      try {
        await messages.getMessages("does-not-exist-at-all", userA.id);
      } catch (e) {
        unknownErr = e;
      }
      assert.ok(foreignErr instanceof EntityNotFoundError);
      assert.ok(unknownErr instanceof EntityNotFoundError);
    });

    await test("security: reconciliation for user A never includes user B's conversation, using real per-user lists", async () => {
      const listForA = await RepositoryFactory.conversations().findByUser(userA.id);
      assert.ok(!listForA.some((c) => c.id === convB.id), "findByUser must already be scoped to the requesting user");

      const recovered = await reconcileServerConversations(listForA);
      assert.ok(!recovered.some((c) => c.serverConversationId === convB.id));
    });

    // -----------------------------------------------------------------
    // Part C: structural sweep - userId is never accepted from a request body
    // -----------------------------------------------------------------
    const routeFiles = [
      "app/api/private/knowledge/chat/route.ts",
      "app/api/private/conversations/route.ts",
      "app/api/private/conversations/[conversationId]/route.ts",
      "app/api/private/conversations/[conversationId]/messages/route.ts",
    ];

    for (const file of routeFiles) {
      await test(`structural: ${file} never reads userId from the request body/query/params`, () => {
        const source = routeSource(file);
        const suspiciousPatterns = [/body\??\.\s*userId/i, /query\??\.\s*userId/i, /params\??\.\s*userId/i];
        for (const pattern of suspiciousPatterns) {
          assert.ok(!pattern.test(source), `${file} must not read userId from client-supplied input (matched ${pattern})`);
        }
        assert.ok(
          source.includes("getUserOrNull"),
          `${file} must derive identity via getUserOrNull()`,
        );
      });
    }
  } finally {
    await prisma.conversation.deleteMany({ where: { id: { in: [convA.id, convASecond.id, convB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });

    const leftoverMessages = await prisma.message.count({
      where: { conversationId: { in: [convA.id, convASecond.id, convB.id] } },
    });
    const leftoverConversations = await prisma.conversation.count({
      where: { id: { in: [convA.id, convASecond.id, convB.id] } },
    });
    const leftoverUsers = await prisma.user.count({ where: { id: { in: [userA.id, userB.id] } } });

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
