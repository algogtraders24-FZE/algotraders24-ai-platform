// app/api/private/knowledge/route.ts
// Sprint 14D - Repository-backed, scoped to the authenticated user.
// Sprint 14E - Returns the full document metadata now that Knowledge is
// fully persisted. Embedding/vector search remains a later sprint.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      ctx.requestId,
      401,
      ctx.startedAt
    );
  }

  const userId = sessionUser.profile.id;

  const [docs, collections] = await Promise.all([
    prisma.knowledge.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.knowledgeCollection.findMany({
      where: { userId, deletedAt: null },
      orderBy: { name: "asc" },
    }),
  ]);

  const collectionNameById = new Map(collections.map((c) => [c.id, c.name]));

  const items = docs.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    collection: d.collectionId
      ? collectionNameById.get(d.collectionId) ?? ""
      : "",
    author: d.author,
    tags: d.tags,
    provider: d.provider,
    language: d.language,
    fileType: d.fileType,
    documentSize: d.documentSize,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    lastIndexed: d.lastIndexed ? d.lastIndexed.toISOString() : null,
    status: d.status,
    embeddingStatus: d.embeddingStatus,
    retrievalCount: d.retrievalCount,
    popularity: d.popularity,
  }));

  const collectionItems = collections.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    documentCount: docs.filter((d) => d.collectionId === c.id).length,
  }));

  return ApiResponse.success(
    { items, collections: collectionItems, total: items.length },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});