// app/api/private/marketplace/listings/route.ts
// Sprint M8 - "My Products" architecture (M8 brief section 4/27):
// ownership-scoped listing of the CALLER's OWN MarketplaceListing rows,
// including non-public states (DRAFT/UNDER_REVIEW/etc.) they own. Public
// catalog browsing is /api/marketplace/search (no auth) - this route is
// the seller-facing management read, auth-gated like every other
// /api/private/* route.
//
// Sprint M9 adds POST (create draft) - M8 deliberately had none ("do not
// create any real product" was an M8-scope rule, not a permanent one; M9's
// own brief calls for a real submission-creation endpoint, still subject
// to every M9 guardrail: no real Gold/100-product listing gets created by
// THIS sprint's own test suite, but the endpoint itself is real and live).
// Creates a DRAFT only - reaches AT24-controlled fields never, reuses
// evaluateListingMutation (M8) for the exact same seller/AT24 field
// boundary the PATCH endpoint enforces, so there is exactly one place that
// decision is made.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { evaluateListingMutation } from "@/services/marketplace/listingMutationGuard";
import { recordSubmissionCreated } from "@/services/marketplace/factory/auditTrail";
import type { MarketplaceListing as PrismaMarketplaceListing } from "@/lib/generated/prisma/client";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "listing";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 8)}`;
    const existing = await prisma.marketplaceListing.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const sellerId = sessionUser.profile.id;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50) || 50));

  const where = { sellerId, deletedAt: null };
  const [rows, total] = await withTableFallback(
    () =>
      Promise.all([
        prisma.marketplaceListing.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.marketplaceListing.count({ where }),
      ]),
    [[], 0] as [PrismaMarketplaceListing[], number],
  );

  return ApiResponse.success(
    {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        media: r.media,
        pricing: r.pricing,
        publicationState: r.publicationState,
        // Sprint M9 - reference ids (not sensitive content, just AT24
        // record pointers) so the seller's own "My Products" view can
        // derive the real SubmissionState (deriveSubmissionState) instead
        // of guessing from publicationState alone.
        evidenceId: r.evidenceId,
        validationId: r.validationId,
        riskAnalysisId: r.riskAnalysisId,
        trustState: r.trustState,
        trustReasonCode: r.trustReasonCode,
        updatedAt: r.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const sellerId = sessionUser.profile.id;

  const rawBody = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!rawBody || typeof rawBody !== "object") {
    return ApiResponse.error({ code: "VALIDATION", message: "Request body must be a JSON object" }, ctx.requestId, 400, ctx.startedAt);
  }

  // tradingSystemId/versionId are a one-shot "which product is this"
  // declaration, accepted only here at creation (never via PATCH, where
  // they remain AT24_ONLY_FIELDS - see M9_product_factory.md section 9,
  // Version immutability). They are handled separately from
  // evaluateListingMutation because that guard's forbidden-field list
  // covers the PATCH surface, where these two must never be re-settable.
  const { tradingSystemId, versionId, ...body } = rawBody;
  if ((tradingSystemId !== undefined && typeof tradingSystemId !== "string") || (versionId !== undefined && typeof versionId !== "string")) {
    return ApiResponse.error({ code: "VALIDATION", message: "tradingSystemId and versionId must be strings when provided" }, ctx.requestId, 400, ctx.startedAt);
  }
  if ((tradingSystemId && !versionId) || (!tradingSystemId && versionId)) {
    return ApiResponse.error({ code: "VALIDATION", message: "tradingSystemId and versionId must be provided together" }, ctx.requestId, 400, ctx.startedAt);
  }

  // Same seller/AT24 field-authorization decision as PATCH - a create body
  // containing e.g. trustState is rejected the same way an update would be.
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

  if (!decision.data.title || !decision.data.title.trim()) {
    return ApiResponse.error({ code: "VALIDATION", message: "title is required to create a draft listing" }, ctx.requestId, 400, ctx.startedAt);
  }

  const slug = await uniqueSlug(decision.data.title);
  const created = await prisma.marketplaceListing.create({
    data: {
      sellerId,
      slug,
      title: decision.data.title,
      description: decision.data.description ?? "",
      media: decision.data.media ?? [],
      pricing: decision.data.pricing ?? {},
      category: decision.data.category ?? "",
      platformTag: decision.data.platformTag ?? "",
      assetTag: decision.data.assetTag ?? "",
      tags: decision.data.tags ?? [],
      tradingSystemId: (tradingSystemId as string | undefined) ?? null,
      versionId: (versionId as string | undefined) ?? null,
      publicationState: "DRAFT",
    },
  });

  await recordSubmissionCreated(sellerId, created.id, created.platformTag);

  return ApiResponse.success(
    { id: created.id, slug: created.slug, title: created.title, publicationState: created.publicationState },
    ctx.requestId,
    201,
    ctx.startedAt,
  );
});
