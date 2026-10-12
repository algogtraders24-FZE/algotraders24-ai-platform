// app/api/private/admin/rewards/products/route.ts
// Admin: POST { key, listingId, enabled } -> bind a program product to its marketplace listing and switch it on or off.
// Switching ON checks that the listing exists, is a one-time price EQUAL to the contract list price, is bound to a TradingSystem/Version
// and has a PUBLISHED build (a product with nothing to deliver is never opened for sale). Switching OFF only needs the key.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { REWARD_PRODUCTS, isRewardProductKey } from "@/lib/rewards/config";

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as { key?: unknown; listingId?: unknown; mt4ListingId?: unknown; enabled?: unknown } | null;
  if (!isRewardProductKey(b?.key) || typeof b?.enabled !== "boolean" || (b.listingId !== null && b.listingId !== undefined && typeof b.listingId !== "string")) {
    return ApiResponse.error({ code: "VALIDATION", message: "key, enabled (boolean) and listingId (text) are required." }, ctx.requestId, 400, ctx.startedAt);
  }
  const cfg = REWARD_PRODUCTS[b.key];
  const listingId = typeof b.listingId === "string" && b.listingId.trim() ? b.listingId.trim() : null;
  const mt4ListingId = typeof b.mt4ListingId === "string" && b.mt4ListingId.trim() ? b.mt4ListingId.trim() : null;

  if (b.enabled) {
    if (!listingId) return ApiResponse.error({ code: "LISTING_REQUIRED", message: "Enter the listing id before switching the product on." }, ctx.requestId, 422, ctx.startedAt);
    const listing = await prisma.marketplaceListing.findFirst({ where: { id: listingId, deletedAt: null } });
    if (!listing) return ApiResponse.error({ code: "LISTING_NOT_FOUND", message: "No listing with that id." }, ctx.requestId, 422, ctx.startedAt);
    const pricing = listing.pricing as Record<string, unknown> | null;
    if (!pricing || pricing.model !== "one_time" || typeof pricing.amount !== "number") {
      return ApiResponse.error({ code: "LISTING_PRICE", message: "The listing needs a one-time price." }, ctx.requestId, 422, ctx.startedAt);
    }
    if (Math.round((pricing.amount as number) * 100) !== cfg.listPriceCents) {
      return ApiResponse.error({ code: "LISTING_PRICE", message: `The listing price must be exactly $${(cfg.listPriceCents / 100).toFixed(2)} for this contract (it is $${(pricing.amount as number).toFixed(2)}).` }, ctx.requestId, 422, ctx.startedAt);
    }
    if (!listing.tradingSystemId || !listing.versionId) {
      return ApiResponse.error({ code: "LISTING_UNBOUND", message: "The listing is not bound to a TradingSystem/Version yet." }, ctx.requestId, 422, ctx.startedAt);
    }
    const release = await prisma.releaseArtifact.findFirst({
      where: { tradingSystemId: listing.tradingSystemId, versionId: listing.versionId, platform: listing.platformTag, releaseStatus: "PUBLISHED", deletedAt: null },
      select: { id: true },
    });
    if (!release) return ApiResponse.error({ code: "NO_RELEASE", message: "The listing has no published build to deliver." }, ctx.requestId, 422, ctx.startedAt);
    // Optional second platform: its licence is issued free with the contract, so it must be a different listing/platform with a published build.
    if (mt4ListingId) {
      const second = await prisma.marketplaceListing.findFirst({ where: { id: mt4ListingId, deletedAt: null } });
      if (!second) return ApiResponse.error({ code: "SECOND_NOT_FOUND", message: "No listing with that second-platform id." }, ctx.requestId, 422, ctx.startedAt);
      if (second.id === listing.id || second.platformTag === listing.platformTag) {
        return ApiResponse.error({ code: "SECOND_SAME_PLATFORM", message: "The second listing must be for the other platform (MT4 vs MT5)." }, ctx.requestId, 422, ctx.startedAt);
      }
      if (!second.tradingSystemId || !second.versionId) return ApiResponse.error({ code: "SECOND_UNBOUND", message: "The second listing is not bound to a TradingSystem/Version yet." }, ctx.requestId, 422, ctx.startedAt);
      const secondRelease = await prisma.releaseArtifact.findFirst({
        where: { tradingSystemId: second.tradingSystemId, versionId: second.versionId, platform: second.platformTag, releaseStatus: "PUBLISHED", deletedAt: null },
        select: { id: true },
      });
      if (!secondRelease) return ApiResponse.error({ code: "SECOND_NO_RELEASE", message: "The second listing has no published build to deliver." }, ctx.requestId, 422, ctx.startedAt);
    }
  }

  await prisma.rewardProduct.upsert({
    where: { key: cfg.key },
    update: { listingId, mt4ListingId, enabled: b.enabled, name: cfg.name, listPriceCents: cfg.listPriceCents, rebateCents: cfg.rebateCents, installments: cfg.installments, intervalDays: cfg.intervalDays, termMonths: cfg.termMonths, referralCents: [...cfg.referralCents] },
    create: { key: cfg.key, name: cfg.name, listingId, mt4ListingId, enabled: b.enabled, listPriceCents: cfg.listPriceCents, rebateCents: cfg.rebateCents, installments: cfg.installments, intervalDays: cfg.intervalDays, termMonths: cfg.termMonths, referralCents: [...cfg.referralCents] },
  });
  await prisma.rewardAuditEvent.create({ data: { actor: gate.user.profile.id, action: b.enabled ? "product.enabled" : "product.disabled", subjectType: "RewardProduct", subjectId: cfg.key, data: { listingId, mt4ListingId } } });
  return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
});
