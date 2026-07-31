// app/api/private/knowledge/upload/route.ts
// Sprint L2.2 - Real document upload. Replaces the simulated flow
// (services/knowledge/KnowledgeManager.ts's uploadDocument, whose own
// comment called it "Simulated upload — creates a pending document from
// minimal input"). This route does the real thing end to end: extract
// text from the actual file, create a real Knowledge row, then hand off
// to the SAME IngestionService that already powers ingest/route.ts -
// zero duplicated chunking/embedding logic.
// SECURITY: userId from session only. collectionId, if provided, must
// belong to the session user (same ownership convention as ingest/route.ts).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { IngestionService } from "@/services/knowledge/IngestionService";
import { extractText, resolveExtension, UnsupportedFileTypeError, FileParseError } from "@/lib/knowledge/extractText";
import { AIProviderError } from "@/lib/ai";
import { analyticsEventService } from "@/services/analytics/AnalyticsEventService";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB raw file
const MAX_TEXT_LENGTH = 100_000; // matches ingest/route.ts's own cap

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const userId = sessionUser.profile.id;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return ApiResponse.error({ code: "VALIDATION", message: "A file is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  if (file.size === 0) {
    return ApiResponse.error({ code: "EMPTY_FILE", message: "This file is empty" }, ctx.requestId, 400, ctx.startedAt);
  }
  if (file.size > MAX_FILE_BYTES) {
    return ApiResponse.error(
      { code: "FILE_TOO_LARGE", message: `File exceeds the ${MAX_FILE_BYTES / (1024 * 1024)}MB limit` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const extension = resolveExtension(file.name, file.type);
  if (!extension) {
    return ApiResponse.error(
      { code: "UNSUPPORTED_FILE_TYPE", message: new UnsupportedFileTypeError(file.name).message },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const titleInput = form.get("title");
  const categoryInput = form.get("category");
  const collectionIdInput = form.get("collectionId");
  const title = typeof titleInput === "string" && titleInput.trim().length > 0 ? titleInput.trim() : file.name.replace(/\.[^/.]+$/, "");
  const category = typeof categoryInput === "string" && categoryInput.trim().length > 0 ? categoryInput.trim() : "general";

  let collectionId: string | null = null;
  if (typeof collectionIdInput === "string" && collectionIdInput.trim().length > 0) {
    const owned = await prisma.knowledgeCollection.findFirst({
      where: { id: collectionIdInput, userId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Collection not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    collectionId = owned.id;
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let text: string;
  try {
    text = await extractText(buffer, file.name, extension);
  } catch (error) {
    const message = error instanceof FileParseError ? error.message : "Could not read this file";
    return ApiResponse.error({ code: "PARSE_FAILED", message }, ctx.requestId, 400, ctx.startedAt);
  }

  if (text.trim().length === 0) {
    return ApiResponse.error(
      { code: "EMPTY_CONTENT", message: "No readable text was found in this file" },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return ApiResponse.error(
      { code: "CONTENT_TOO_LONG", message: `This document's text exceeds the ${MAX_TEXT_LENGTH.toLocaleString()} character limit` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const knowledge = await prisma.knowledge.create({
    data: {
      userId,
      title,
      category,
      collectionId,
      fileType: extension,
      documentSize: file.size,
      source: "upload",
      status: "processing",
      embeddingStatus: "processing",
    },
  });

  try {
    const service = new IngestionService();
    const result = await service.ingest({ knowledgeId: knowledge.id, userId, text });

    const indexed = result.embeddingsStored > 0;
    const finalStatus = result.chunksCreated === 0 || !indexed ? "failed" : "indexed";
    const finalEmbeddingStatus = result.chunksCreated === 0 || !indexed ? "failed" : "embedded";

    const updated = await prisma.knowledge.update({
      where: { id: knowledge.id },
      data: {
        status: finalStatus,
        embeddingStatus: finalEmbeddingStatus,
        chunkCount: result.chunksCreated,
        lastIndexed: indexed ? new Date() : null,
      },
    });

    // Sprint R1.2 - Phase 2: real "knowledge_upload" event, additive and
    // best-effort. Fires whenever the file itself was successfully
    // uploaded, regardless of whether embedding also succeeded - the
    // upload is the real action being observed here, not the indexing
    // outcome.
    await analyticsEventService.record(userId, "knowledge_upload").catch(() => {});

    return ApiResponse.success(
      {
        document: {
          id: updated.id,
          title: updated.title,
          description: updated.description,
          category: updated.category,
          author: updated.author,
          tags: updated.tags,
          provider: updated.provider,
          language: updated.language,
          fileType: updated.fileType,
          documentSize: updated.documentSize,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          lastIndexed: updated.lastIndexed ? updated.lastIndexed.toISOString() : null,
          status: updated.status,
          embeddingStatus: updated.embeddingStatus,
          retrievalCount: updated.retrievalCount,
          popularity: updated.popularity,
        },
        chunksCreated: result.chunksCreated,
        embeddingsStored: result.embeddingsStored,
        embeddingsFailed: result.embeddingsFailed,
      },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch (error) {
    // Never leave a Knowledge row stuck at "processing" forever.
    await prisma.knowledge.update({
      where: { id: knowledge.id },
      data: { status: "failed", embeddingStatus: "failed" },
    }).catch(() => {});

    const code = error instanceof AIProviderError ? "EMBEDDING_FAILED" : "INGEST_FAILED";
    const message =
      error instanceof AIProviderError
        ? "The embedding provider is unavailable right now"
        : "Ingestion could not be completed";
    return ApiResponse.error({ code, message }, ctx.requestId, 500, ctx.startedAt);
  }
});
