// app/api/private/marketplace/listings/[id]/report/route.ts
// Seller self-serve (Phase 2): attach the MT5 Strategy Tester report to a listing. Same direct-to-storage pattern as the
// product file (the report can be tens of MB, Vercel's body limit is ~4.5 MB).
//   POST { action: "upload-url", fileName, size } -> { path, token }
//   POST { action: "finalize", path }             -> queues a ReportCheckJob; the AT24 VPS worker picks it up
// GET -> { check: { status, reason, fileName } | null }  (the seller's own latest job)
// The seller is never blocked on the result: the listing is sold as "Not checked" until a finished check exists.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { createBuildUploadUrl } from "@/lib/marketplace/buildStorage";
import { selfServeAllowedFor, sanitizeFileName, extensionOf } from "@/lib/marketplace/selfServe";
import { ALLOWED_REPORT_EXTENSIONS, MAX_REPORT_BYTES, isAllowedReportFile } from "@/lib/marketplace/reportCheck";
import { enqueueReportCheck, reportCheckStatusForSeller } from "@/services/marketplace/reportCheckStore";

export const maxDuration = 30;

function listingIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("listings");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

async function authorize(ctx: { path: string; requestId: string; startedAt: number }) {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return { ok: false as const, error: ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt) };
  }
  if (!selfServeAllowedFor(sessionUser.profile.email)) {
    return { ok: false as const, error: ApiResponse.error({ code: "SELF_SERVE_UNAVAILABLE", message: "Self-serve listing is not open for this account yet." }, ctx.requestId, 403, ctx.startedAt) };
  }
  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) {
    return { ok: false as const, error: ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt) };
  }
  const sellerId = sessionUser.profile.id;
  const listing = await withTableFallback(() => prisma.marketplaceListing.findFirst({ where: { id: listingId, sellerId, deletedAt: null } }), null);
  if (!listing) {
    return { ok: false as const, error: ApiResponse.error({ code: "NOT_FOUND", message: "Listing not found" }, ctx.requestId, 404, ctx.startedAt) };
  }
  return { ok: true as const, listingId, sellerId };
}

export const GET = withContext(async (_req, ctx) => {
  const auth = await authorize(ctx);
  if (!auth.ok) return auth.error;
  const check = await reportCheckStatusForSeller(auth.listingId, auth.sellerId);
  return ApiResponse.success({ check }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const auth = await authorize(ctx);
  if (!auth.ok) return auth.error;
  const { listingId, sellerId } = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;

  if (action === "upload-url") {
    const fileName = typeof body?.fileName === "string" ? body.fileName : "";
    const size = typeof body?.size === "number" ? body.size : 0;
    if (!isAllowedReportFile(fileName)) {
      return ApiResponse.error({ code: "UNSUPPORTED_FILE_TYPE", message: `The report must be the MT5 Strategy Tester export: ${ALLOWED_REPORT_EXTENSIONS.join(" ")} (got "${extensionOf(fileName) || "no extension"}").` }, ctx.requestId, 400, ctx.startedAt);
    }
    if (!(size > 0) || size > MAX_REPORT_BYTES) {
      return ApiResponse.error({ code: "BAD_SIZE", message: `The report must be between 1 byte and ${MAX_REPORT_BYTES / (1024 * 1024)} MB. For a bigger report, test a shorter period.` }, ctx.requestId, 400, ctx.startedAt);
    }
    // A seller cannot queue unlimited work for our VPS: at most 3 reports per listing per day.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.reportCheckJob.count({ where: { listingId, createdAt: { gte: since } } });
    if (recent >= 3) {
      return ApiResponse.error({ code: "DAILY_LIMIT", message: "You can attach up to 3 reports per listing per day." }, ctx.requestId, 429, ctx.startedAt);
    }
    const objectPath = `${listingId}/report-${Date.now().toString(36)}-${sanitizeFileName(fileName)}`;
    const signed = await createBuildUploadUrl(objectPath);
    return ApiResponse.success({ path: signed.path, token: signed.token }, ctx.requestId, 200, ctx.startedAt);
  }

  if (action === "finalize") {
    const path = typeof body?.path === "string" ? body.path : "";
    const size = typeof body?.size === "number" ? body.size : 0;
    if (!path.startsWith(`${listingId}/report-`)) {
      return ApiResponse.error({ code: "VALIDATION", message: "That file is not a report for this listing." }, ctx.requestId, 400, ctx.startedAt);
    }
    const fileName = path.slice(listingId.length + 1).replace(/^report-[a-z0-9]+-/, "");
    if (!isAllowedReportFile(fileName)) {
      return ApiResponse.error({ code: "UNSUPPORTED_FILE_TYPE", message: "Unsupported report type." }, ctx.requestId, 400, ctx.startedAt);
    }
    const job = await enqueueReportCheck({ listingId, sellerId, storageKey: path, fileName, sizeBytes: Math.min(Math.max(Math.round(size), 0), MAX_REPORT_BYTES) });
    return ApiResponse.success({ jobId: job.id, status: job.status }, ctx.requestId, 201, ctx.startedAt);
  }

  return ApiResponse.error({ code: "VALIDATION", message: 'action must be "upload-url" or "finalize"' }, ctx.requestId, 400, ctx.startedAt);
});
