// app/api/private/licenses/[licenseId]/download/route.ts
// Sprint M13 (closing the marketplace delivery loop) - the ONE real way to
// retrieve a purchased EA's compiled binary. Deliberately NOT a public
// static file under public/ (unlike icon.svg/banner.svg) - this is the
// paid product itself, gated on the requester genuinely owning a License
// for this exact release (browser-session-authenticated, same pattern as
// reveal-key/route.ts). See register-releases.ts for why the file lives
// in private-releases/<releaseId>.ex5, outside Next's static-serving root.
import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { recordReleaseDownload } from "@/services/licensing/auditTrail";
import { downloadBuild } from "@/lib/marketplace/buildStorage";
import { extensionOf } from "@/lib/marketplace/selfServe";

const RELEASES_DIR = path.join(process.cwd(), "private-releases");

function licenseIdFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("licenses");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const licenseId = licenseIdFromPath(ctx.path);
  if (!licenseId) {
    return ApiResponse.error({ code: "VALIDATION", message: "license id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const license = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!license) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "License not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  if (license.buyerId !== sessionUser.profile.id) {
    return ApiResponse.error({ code: "FORBIDDEN", message: "This license does not belong to you" }, ctx.requestId, 403, ctx.startedAt);
  }

  const release = await prisma.releaseArtifact.findUnique({ where: { id: license.releaseId } });
  if (!release || release.releaseStatus !== "PUBLISHED" || release.deletedAt) {
    return ApiResponse.error({ code: "RELEASE_NOT_AVAILABLE", message: "This release is not currently available for download (revoked/deprecated)." }, ctx.requestId, 409, ctx.startedAt);
  }

  // Phase 5: a listing suspended after buyer reports pauses downloads until the owner decides (existing installs keep running).
  const suspended = release.marketplaceListingId
    ? await prisma.marketplaceListing.count({ where: { id: release.marketplaceListingId, publicationState: "SUSPENDED" } })
    : 0;
  if (suspended > 0) {
    return ApiResponse.error({ code: "LISTING_SUSPENDED", message: "This product is temporarily suspended while buyer reports are reviewed. Downloads resume if it is cleared." }, ctx.requestId, 409, ctx.startedAt);
  }

  let bytes: Buffer | null = null;
  let storedExt = ".ex5";
  let filename = `${release.tradingSystemId}_${release.artifactVersion}.ex5`;
  if (release.storageKey) {
    // Seller self-serve release: the file is in the private Supabase Storage bucket, never in the repo.
    try {
      bytes = await downloadBuild(release.storageKey);
    } catch {
      return ApiResponse.error({ code: "FILE_MISSING", message: "The release file could not be read from storage." }, ctx.requestId, 500, ctx.startedAt);
    }
    filename = release.fileName || filename;
    storedExt = extensionOf(filename);
  } else {
    // Stored name is private-releases/<releaseId><ext>. .ex5 is the original convention; .ex4 (MT4
    // binaries) and .zip (multi-file bundles, e.g. the Trade Copier) are looked up after it.
    for (const ext of [".ex5", ".ex4", ".zip"]) {
      try {
        bytes = await readFile(path.join(RELEASES_DIR, `${release.id}${ext}`));
        storedExt = ext;
        break;
      } catch {
        // try the next extension
      }
    }
    if (!bytes) {
      return ApiResponse.error({ code: "FILE_MISSING", message: "The release binary is registered but its file is missing on this server." }, ctx.requestId, 500, ctx.startedAt);
    }
    try {
      filename = (await readFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), "utf-8")).trim() || filename;
    } catch {
      // filename mapping missing - fall back to the derived name above, not fatal.
      filename = filename.replace(/\.ex5$/, storedExt);
    }
  }

  await recordReleaseDownload({ actorUserId: sessionUser.profile.id, releaseId: release.id, licenseId: license.id });

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": storedExt === ".zip" ? "application/zip" : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename.replace(/["\r\n]/g, "_")}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
});
