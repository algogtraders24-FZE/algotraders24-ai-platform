// services/knowledge/personal-rules.ts
// The user's own "My Trading Rules" document, read back as plain text so Ask AI can have it in front of it on EVERY
// question (not only when a similarity search happens to match). Read-only, owner-scoped, best effort: any failure
// returns "" and the assistant simply answers without rules.
import { prisma } from "@/lib/prisma";
import { TRADING_RULES_TITLE } from "@/lib/knowledge/trading-rules";

/** ~1,500 tokens: the rules form's fields are capped well below this, so a normal document is never cut. */
export const MAX_PERSONAL_RULES_CHARS = 6000;

/** Joins the document's chunks (already in order) and caps the length. Pure. */
export function joinRuleChunks(chunks: readonly string[]): string {
  const text = chunks.map((c) => c.trim()).filter((c) => c.length > 0).join("\n");
  return text.length > MAX_PERSONAL_RULES_CHARS ? text.slice(0, MAX_PERSONAL_RULES_CHARS) : text;
}

export async function loadPersonalRules(userId: string): Promise<string> {
  try {
    const doc = await prisma.knowledge.findFirst({
      where: { userId, title: TRADING_RULES_TITLE, deletedAt: null, status: "indexed" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!doc) return "";
    const chunks = await prisma.knowledgeChunk.findMany({
      where: { knowledgeId: doc.id, userId, deletedAt: null },
      orderBy: { chunkIndex: "asc" },
      select: { content: true },
    });
    return joinRuleChunks(chunks.map((c) => c.content));
  } catch {
    return "";
  }
}
