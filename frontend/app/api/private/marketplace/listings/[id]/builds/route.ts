// app/api/private/marketplace/listings/[id]/builds/route.ts
// Seller self-serve (Phase 1): upload the product file straight to private storage and register it as a release.
//   POST { action: "upload-url", fileName, size }  -> { path, token }   (one-time signed upload URL, browser -> Supabase)
//   POST { action: "finalize", path }              -> reads the stored file, runs file hygiene, hashes it, and creates a
//                                                     PUBLISHED ReleaseArtifact bound to this listing (SELF-<listingId>)
// The browser never writes to the bucket without a URL minted here after the auth + ownership + flag checks, and the file
// is never readable from the browser. Vercel's ~4.5 MB request-body limit is why the upload is direct, not through us.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { createBuildUploadUrl, downloadBuild, removeBuild } from "@/lib/marketplace/buildStorage";
import { selfServeAllowedFor, sanitizeFileName, extensionOf, ALLOWED_PRODUCT_EXTENSIONS, BLOCKED_EXTENSIONS, MAX_BUILD_BYTES } from "@/lib/marketplace/selfServe";
import { sellerGate } from "@/services/marketplace/identityStore";
import { inspectBuild } from "@/lib/marketplace/buildInspect";

export const maxDuration = 60;

function listingIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("listings");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const sellerId = sessionUser.profile.id;
  if (!selfServeAllowedFor(sessionUser.profile.email)) {
    return ApiResponse.error({ code: "SELF_SERVE_UNAVAILABLE", message: "Self-serve listing is not open for this account yet." }, ctx.requestId, 403, ctx.startedAt);
  }


  const unverified = await sellerGate({ id: sessionUser.profile.id, email: sessionUser.profile.email, emailVerified: sessionUser.profile.emailVerified });
  if (unverified) {
    return ApiResponse.error({ code: "SELLER_NOT_VERIFIED", message: unverified }, ctx.requestId, 403, ctx.startedAt);
  }

  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) {
    return ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt);
  }
  const listing = await withTableFallback(
    () => prisma.marketplaceListing.findFirst({ where: { id: listingId, sellerId, deletedAt: null } }),
    null,
  );
  if (!listing) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Listing not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;

  if (action === "upload-url") {
    const fileName = typeof body?.fileName === "string" ? body.fileName : "";
    const size = typeof body?.size === "number" ? body.size : 0;
    const ext = extensionOf(fileName);
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      return ApiResponse.error({ code: "BLOCKED_FILE_TYPE", message: `Files of type ${ext} cannot be sold on the marketplace.` }, ctx.requestId, 400, ctx.startedAt);
    }
    if (!ALLOWED_PRODUCT_EXTENSIONS.includes(ext)) {
      return ApiResponse.error({ code: "UNSUPPORTED_FILE_TYPE", message: `Unsupported file type "${ext || "(none)"}". Allowed: ${ALLOWED_PRODUCT_EXTENSIONS.join(" ")}` }, ctx.requestId, 400, ctx.startedAt);
    }
    if (!(size > 0) || size > MAX_BUILD_BYTES) {
      return ApiResponse.error({ code: "BAD_SIZE", message: `The file must be between 1 byte and ${MAX_BUILD_BYTES / (1024 * 1024)} MB.` }, ctx.requestId, 400, ctx.startedAt);
    }
    const objectPath = `${listingId}/${Date.now().toString(36)}-${sanitizeFileName(fileName)}`;
    const signed = await createBuildUploadUrl(objectPath);
    return ApiResponse.success({ path: signed.path, token: signed.token }, ctx.requestId, 200, ctx.startedAt);
  }

  if (action === "finalize") {
    const path = typeof body?.path === "string" ? body.path : "";
    if (!path.startsWith(`${listingId}/`) || path.startsWith(`${listingId}/report-`)) {
      return ApiResponse.error({ code: "VALIDATION", message: "That file does not belong to this listing." }, ctx.requestId, 400, ctx.startedAt);
    }
    let buf: Buffer;
    try {
      buf = await downloadBuild(path);
    } catch {
      return ApiResponse.error({ code: "UPLOAD_MISSING", message: "The uploaded file was not found - please upload it again." }, ctx.requestId, 404, ctx.startedAt);
    }
    const fileName = path.slice(listingId.length + 1).replace(/^[a-z0-9]+-/, "");
    const inspection = inspectBuild(fileName, buf);
    if (!inspection.ok) {
      await removeBuild(path).catch(() => undefined);
      return ApiResponse.error({ code: "BUILD_REJECTED", message: inspection.reasons.join(" ") }, ctx.requestId, 422, ctx.startedAt);
    }

    if (listing.tradingSystemId && !listing.tradingSystemId.startsWith("SELF-")) {
      await removeBuild(path).catch(() => undefined);
      return ApiResponse.error({ code: "NOT_SELF_SERVE", message: "This listing is managed through AT24's evidence process; its file cannot be replaced here." }, ctx.requestId, 409, ctx.startedAt);
    }
    const tradingSystemId = `SELF-${listingId}`;
    const platform = listing.platformTag;
    if (!platform) {
      return ApiResponse.error({ code: "VALIDATION", message: "Set the platform on the listing before uploading the file." }, ctx.requestId, 400, ctx.startedAt);
    }
    const previous = await prisma.releaseArtifact.findMany({
      where: { tradingSystemId, deletedAt: null },
      select: { id: true, versionId: true, releaseStatus: true, artifactHash: true, platform: true },
      orderBy: { createdAt: "desc" },
    });
    const same = previous.find((r) => r.artifactHash === inspection.sha256 && r.platform === platform);
    const versionId = same ? same.versionId : `v1.${previous.length}`;

    const release = await prisma.releaseArtifact.upsert({
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId, versionId, platform, artifactHash: inspection.sha256 } },
      create: {
        tradingSystemId, versionId, platform, marketplaceListingId: listingId, artifactVersion: versionId, artifactHash: inspection.sha256,
        releaseStatus: "PUBLISHED", storageKey: path, fileName, sizeBytes: inspection.sizeBytes,
      },
      update: { releaseStatus: "PUBLISHED", storageKey: path, fileName, sizeBytes: inspection.sizeBytes },
    });

    // A newer build supersedes older self-serve releases of this listing - but never one a buyer already holds a licence on.
    for (const old of previous) {
      if (old.id === release.id || old.releaseStatus !== "PUBLISHED") continue;
      if ((await prisma.license.count({ where: { releaseId: old.id } })) > 0) continue;
      await prisma.releaseArtifact.update({ where: { id: old.id }, data: { releaseStatus: "DEPRECATED" } });
    }

    await prisma.marketplaceListing.update({ where: { id: listingId }, data: { tradingSystemId, versionId } });
    return ApiResponse.success(
      { releaseId: release.id, versionId, fileName, sizeBytes: inspection.sizeBytes, sha256: inspection.sha256 },
      ctx.requestId,
      201,
      ctx.startedAt,
    );
  }

  return ApiResponse.error({ code: "VALIDATION", message: 'action must be "upload-url" or "finalize"' }, ctx.requestId, 400, ctx.startedAt);
});
