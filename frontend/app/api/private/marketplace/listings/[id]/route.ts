// app/api/private/marketplace/listings/[id]/route.ts
// Sprint M8 - Seller/AT24 permission boundary (section 15/24/26), enforced
// server-side, not just in the UI. PATCH allows a seller to update ONLY
// their own listing's seller-owned presentation fields - Evidence,
// Validation, RiskAnalysis, History, and Trust State fields are never
// settable through this endpoint, for ANY caller including the owner and
// including a would-be admin. The actual authorization decision lives in
// services/marketplace/listingMutationGuard.ts (pure, independently unit-
// tested in scripts/validate-marketplace-platform.ts) - this file is just
// the HTTP wiring around it.
//
// Ownership check follows the exact pattern established in
// app/api/private/knowledge/[knowledgeId]/reindex/route.ts: `where: { id,
// sellerId, deletedAt: null }`, returning 404 (not 403) on a mismatch so
// existence isn't leaked. withContext's RouteHandler has no `params`
// argument (see that file's own comment) - the id is parsed from ctx.path,
// same workaround.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { evaluateListingMutation } from "@/services/marketplace/listingMutationGuard";

function listingIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("listings");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const PATCH = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const sellerId = sessionUser.profile.id;

  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) {
    return ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  // Table-missing (pre-migration) degrades to the same "not found" result
  // a real absent row would produce - see services/marketplace/tableGuard.ts.
  const owned = await withTableFallback(
    () => prisma.marketplaceListing.findFirst({ where: { id: listingId, sellerId, deletedAt: null }, select: { id: true } }),
    null,
  );
  if (!owned) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Listing not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return ApiResponse.error({ code: "VALIDATION", message: "Request body must be a JSON object" }, ctx.requestId, 400, ctx.startedAt);
  }

  const decision = evaluateListingMutation(body);
  if (!decision.ok) {
    const messages: Record<typeof decision.reason, string> = {
      FORBIDDEN_FIELD: `The following fields are AT24-controlled and cannot be set by a seller: ${decision.fields.join(", ")}`,
      UNKNOWN_FIELD: `Unknown field(s): ${decision.fields.join(", ")}`,
      INVALID_FIELD_TYPE: `Invalid type for field(s): ${decision.fields.join(", ")}`,
    };
    const status = decision.reason === "FORBIDDEN_FIELD" ? 403 : 400;
    return ApiResponse.error({ code: decision.reason, message: messages[decision.reason] }, ctx.requestId, status, ctx.startedAt);
  }

  const updated = await prisma.marketplaceListing.update({ where: { id: listingId }, data: decision.data });
  return ApiResponse.success(
    { id: updated.id, slug: updated.slug, title: updated.title, updatedAt: updated.updatedAt.toISOString() },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
