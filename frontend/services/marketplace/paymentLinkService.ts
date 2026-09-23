// services/marketplace/paymentLinkService.ts
// Shareable Payment Links - admin-generated shareable checkout URLs for a
// specific marketplace listing. This service owns only the PaymentLink
// row's own lifecycle (create/resolve/record-use/revoke/list) - it never
// creates a Purchase/Entitlement/License itself. The checkout route this
// backs (app/api/private/payment-links/[token]/checkout/route.ts) calls the
// existing Stripe/NOWPayments provider methods directly, the same way a
// direct listing-page purchase does.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { PUBLICLY_VISIBLE_STATES } from "@/types/marketplace";

function generateToken(): string {
  return `at24_pay_${randomBytes(24).toString("base64url")}`;
}

export interface CreatePaymentLinkInput {
  listingId: string;
  createdByUserId: string;
  expiresAt?: Date;
  maxUses?: number;
}

export type PaymentLinkCreateError =
  | { code: "NOT_FOUND"; message: string }
  | { code: "NOT_PURCHASABLE"; message: string };

export async function createPaymentLink(
  input: CreatePaymentLinkInput,
): Promise<{ id: string; token: string } | PaymentLinkCreateError> {
  const listing = await withTableFallback(
    () =>
      prisma.marketplaceListing.findFirst({
        where: { id: input.listingId, deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } },
      }),
    null,
  );
  if (!listing) {
    return { code: "NOT_FOUND", message: "Listing not found" };
  }

  const pricing = listing.pricing as Record<string, unknown> | null;
  const model = pricing && typeof pricing === "object" ? pricing.model : null;
  const amount = pricing && typeof pricing === "object" ? pricing.amount : null;
  if (model !== "one_time" || typeof amount !== "number" || amount <= 0) {
    return { code: "NOT_PURCHASABLE", message: "This listing does not have a valid one-time price set" };
  }

  const link = await prisma.paymentLink.create({
    data: {
      token: generateToken(),
      marketplaceListingId: input.listingId,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt ?? null,
      maxUses: input.maxUses ?? null,
    },
  });
  return { id: link.id, token: link.token };
}

export interface PaymentLinkListItem {
  id: string;
  token: string;
  status: string;
  marketplaceListingId: string;
  listingTitle: string | null;
  listingSlug: string | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usageCount: number;
  createdAt: Date;
  revokedAt: Date | null;
}

export async function listPaymentLinks(params: { page: number; pageSize: number }): Promise<{ items: PaymentLinkListItem[]; total: number }> {
  const { page, pageSize } = params;
  const [rows, total] = await Promise.all([
    prisma.paymentLink.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.paymentLink.count(),
  ]);

  const listingIds = [...new Set(rows.map((r) => r.marketplaceListingId))];
  const listings =
    listingIds.length > 0
      ? await prisma.marketplaceListing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true, slug: true } })
      : [];
  const byId = new Map(listings.map((l) => [l.id, l]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      token: r.token,
      status: r.status,
      marketplaceListingId: r.marketplaceListingId,
      listingTitle: byId.get(r.marketplaceListingId)?.title ?? null,
      listingSlug: byId.get(r.marketplaceListingId)?.slug ?? null,
      expiresAt: r.expiresAt,
      maxUses: r.maxUses,
      usageCount: r.usageCount,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
    })),
    total,
  };
}

export async function revokePaymentLink(id: string): Promise<boolean> {
  const result = await prisma.paymentLink.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  return result.count > 0;
}

export interface ResolvedPaymentLink {
  linkId: string;
  listing: {
    id: string;
    title: string;
    description: string;
    media: string[];
    slug: string;
    tradingSystemId: string | null;
    versionId: string | null;
    platformTag: string;
    amount: number;
    currency: string;
  };
}

// Both outcomes are deliberately generic - a revoked, expired, exhausted,
// or never-existent token all look identical to an anonymous caller (no
// token-enumeration signal); a currently-unpurchasable listing gets its
// own code only because it's a real state change unrelated to the token
// itself, useful for a slightly more honest UI message.
export type PaymentLinkResolveError = { code: "NOT_FOUND" } | { code: "LISTING_UNAVAILABLE" };

// Always a fresh join - never cached. Called both for display (the public
// resolve route) and immediately before checkout, so a listing's current
// price/publication state is what a buyer always sees and what checkout
// always uses - never anything frozen at link-creation time.
export async function resolvePaymentLink(token: string): Promise<ResolvedPaymentLink | PaymentLinkResolveError> {
  const link = await prisma.paymentLink.findUnique({ where: { token } });
  if (!link) return { code: "NOT_FOUND" };
  if (link.status !== "ACTIVE") return { code: "NOT_FOUND" };
  if (link.expiresAt && link.expiresAt <= new Date()) return { code: "NOT_FOUND" };
  if (link.maxUses !== null && link.usageCount >= link.maxUses) return { code: "NOT_FOUND" };

  const listing = await withTableFallback(
    () =>
      prisma.marketplaceListing.findFirst({
        where: { id: link.marketplaceListingId, deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } },
      }),
    null,
  );
  if (!listing) return { code: "LISTING_UNAVAILABLE" };

  const pricing = listing.pricing as Record<string, unknown> | null;
  const model = pricing && typeof pricing === "object" ? pricing.model : null;
  const amount = pricing && typeof pricing === "object" ? pricing.amount : null;
  if (model !== "one_time" || typeof amount !== "number" || amount <= 0) return { code: "LISTING_UNAVAILABLE" };
  const currency = (pricing as { currency?: string }).currency ?? "USD";

  return {
    linkId: link.id,
    listing: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      media: listing.media,
      slug: listing.slug,
      tradingSystemId: listing.tradingSystemId,
      versionId: listing.versionId,
      platformTag: listing.platformTag,
      amount,
      currency,
    },
  };
}

// Atomic conditional UPDATE - re-checks status/expiry/maxUses in the same
// statement as the increment, so two concurrent checkout attempts against a
// link with maxUses=1 can never both succeed. The naive "resolve, then
// increment" sequence has exactly this race; this closes it. Returns false
// when the link was no longer usable at the exact instant of the attempt
// (affected rows === 0) - the caller must reject the checkout in that case.
export async function recordPaymentLinkUse(token: string): Promise<boolean> {
  const affected = await prisma.$executeRaw`
    UPDATE payment_links
    SET "usageCount" = "usageCount" + 1, "updatedAt" = now()
    WHERE token = ${token}
      AND status = 'ACTIVE'
      AND ("expiresAt" IS NULL OR "expiresAt" > now())
      AND ("maxUses" IS NULL OR "usageCount" < "maxUses")
  `;
  return affected > 0;
}
