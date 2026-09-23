// app/api/private/admin/payment-links/route.ts
// Shareable Payment Links - admin create + list. requireAdmin is the same
// gate every other /api/private/admin/* route uses - link generation is
// admin-only, per the locked brief (no seller-generated links this phase).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { createPaymentLink, listPaymentLinks } from "@/services/marketplace/paymentLinkService";
import { getSiteUrl } from "@/lib/payments/env";
import { prisma } from "@/lib/prisma";

function paymentLinkUrl(token: string): string {
  return `${getSiteUrl().replace(/\/$/, "")}/pay/${token}`;
}

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  // Accepts a listing SLUG (the human-readable identifier visible in the
  // public /marketplace/{slug} URL) rather than the internal cuid, since
  // there's no admin listing-picker UI to look the id up from - an admin
  // reads the slug off the listing page itself.
  const body = (await req.json().catch(() => null)) as { listingSlug?: unknown; expiresAt?: unknown; maxUses?: unknown } | null;
  const listingSlug = typeof body?.listingSlug === "string" ? body.listingSlug.trim() : null;
  if (!listingSlug) {
    return ApiResponse.error({ code: "VALIDATION", message: "listingSlug is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const listing = await prisma.marketplaceListing.findUnique({ where: { slug: listingSlug }, select: { id: true } });
  if (!listing) {
    return ApiResponse.error({ code: "NOT_FOUND", message: `No listing found with slug "${listingSlug}"` }, ctx.requestId, 404, ctx.startedAt);
  }
  const listingId = listing.id;

  let expiresAt: Date | undefined;
  if (typeof body?.expiresAt === "string" && body.expiresAt.length > 0) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return ApiResponse.error({ code: "VALIDATION", message: "expiresAt must be a valid date" }, ctx.requestId, 400, ctx.startedAt);
    }
    expiresAt = parsed;
  }

  let maxUses: number | undefined;
  if (typeof body?.maxUses === "number") {
    if (!Number.isInteger(body.maxUses) || body.maxUses <= 0) {
      return ApiResponse.error({ code: "VALIDATION", message: "maxUses must be a positive integer" }, ctx.requestId, 400, ctx.startedAt);
    }
    maxUses = body.maxUses;
  }

  const result = await createPaymentLink({ listingId, createdByUserId: gate.user.profile.id, expiresAt, maxUses });
  if ("code" in result) {
    const status = result.code === "NOT_FOUND" ? 404 : 409;
    return ApiResponse.error(result, ctx.requestId, status, ctx.startedAt);
  }

  return ApiResponse.success({ id: result.id, token: result.token, url: paymentLinkUrl(result.token) }, ctx.requestId, 201, ctx.startedAt);
});

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20") || 20;

  const result = await listPaymentLinks({ page, pageSize });
  const items = result.items.map((item) => ({ ...item, url: paymentLinkUrl(item.token) }));
  return ApiResponse.success({ items, total: result.total, page, pageSize }, ctx.requestId, 200, ctx.startedAt);
});
