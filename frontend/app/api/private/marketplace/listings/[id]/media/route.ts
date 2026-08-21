// app/api/private/marketplace/listings/[id]/media/route.ts
// Sprint M12 branding follow-on - real image upload for a listing's `media`
// array. Mirrors app/api/private/knowledge/upload/route.ts's real-file
// pattern (formData -> validate -> store -> return a reference), and the
// existing [id]/route.ts's auth+ownership+id-from-path pattern. This route
// only stores the file and returns its public URL - it does NOT write to
// `MarketplaceListing.media` itself, so the exact same
// evaluateListingMutation guard the PATCH endpoint already enforces (media
// is seller-mutable, see listingMutationGuard.ts) is still the only place
// that column is ever written. The caller uploads, gets a URL back, then
// PATCHes `{ media: [...] }` with it included.
//
// No image-hosting service exists yet in this app (confirmed by reading
// MarketplaceListingCard.tsx / [slug]/page.tsx before building this - see
// M12 branding follow-on notes) - files are written under
// public/marketplace/<listingId>/, served by Next's own static file
// handling, same as every other file already in public/.
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { readImageDimensions } from "@/lib/marketplace/imageDimensions";

const MAX_BYTES = 3 * 1024 * 1024; // 3MB - these are logos/banners, not galleries
const ALLOWED: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MEDIA_ROOT = path.join(process.cwd(), "public", "marketplace");
// Matches MQL5 Market's own product-icon convention (see M12 branding
// follow-on discussion) - enforced only for kind="icon"; banner/screenshot
// uploads have no fixed-dimension requirement.
const ICON_SIZE = 200;
type MediaKind = "icon" | "banner" | "screenshot";
function isMediaKind(v: unknown): v is MediaKind {
  return v === "icon" || v === "banner" || v === "screenshot";
}

function listingIdFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("listings");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

function sanitizeBaseName(name: string): string {
  const base = name.replace(/\.[^/.]+$/, "");
  const cleaned = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 60) || "asset";
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const sellerId = sessionUser.profile.id;

  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) {
    return ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const owned = await withTableFallback(
    () => prisma.marketplaceListing.findFirst({ where: { id: listingId, sellerId, deletedAt: null }, select: { id: true } }),
    null,
  );
  if (!owned) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Listing not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return ApiResponse.error({ code: "VALIDATION", message: "A file is required" }, ctx.requestId, 400, ctx.startedAt);
  }
  if (file.size === 0) {
    return ApiResponse.error({ code: "EMPTY_FILE", message: "This file is empty" }, ctx.requestId, 400, ctx.startedAt);
  }
  if (file.size > MAX_BYTES) {
    return ApiResponse.error(
      { code: "FILE_TOO_LARGE", message: `File exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return ApiResponse.error(
      { code: "UNSUPPORTED_FILE_TYPE", message: "Only SVG, PNG, JPEG, or WebP images are accepted" },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const kindInput = form.get("kind");
  const kind: MediaKind = isMediaKind(kindInput) ? kindInput : "screenshot";

  const buffer = Buffer.from(await file.arrayBuffer());

  // Icon dimension check: fail-closed only when the dimensions ARE
  // determined and don't match; fail-open (allow) when the format variant
  // isn't recognized by readImageDimensions - this is a UX guardrail
  // (consistent, professional-looking catalog cards), not a security
  // boundary, so an unrecognized-but-legitimate file should never be
  // blocked on a parsing gap.
  if (kind === "icon") {
    const dims = readImageDimensions(buffer, file.type);
    if (dims && (dims.width !== ICON_SIZE || dims.height !== ICON_SIZE)) {
      return ApiResponse.error(
        { code: "INVALID_ICON_DIMENSIONS", message: `Icon must be exactly ${ICON_SIZE}x${ICON_SIZE}px (this file is ${dims.width}x${dims.height}px).` },
        ctx.requestId,
        400,
        ctx.startedAt,
      );
    }
  }

  const dir = path.join(MEDIA_ROOT, listingId);
  await mkdir(dir, { recursive: true });
  const filename = `${sanitizeBaseName(file.name)}-${Date.now().toString(36)}.${ext}`;
  await writeFile(path.join(dir, filename), buffer);

  const url = `/marketplace/${listingId}/${filename}`;
  return ApiResponse.success({ url }, ctx.requestId, 201, ctx.startedAt);
});
