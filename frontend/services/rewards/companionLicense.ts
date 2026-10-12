// services/rewards/companionLicense.ts
// (Server only.) A reward product can carry a SECOND listing for the other platform (MT4 next to MT5). When the contract is created the
// buyer also gets that platform's licence, free (amount 0), with the same 12-month expiry as the main licence. Idempotent: the purchase
// reference is "<paymentId>:p2", and issueLicenseForPurchase returns the existing licence for a reference it has already seen.
import { prisma } from "@/lib/prisma";
import { issueLicenseForPurchase } from "@/services/licensing/licenseService";
import type { PlatformName } from "@/types/marketplace-factory";

export type CompanionResult = { issued: false; reason: "NONE" | "NO_RELEASE" } | { issued: true; duplicate: boolean; licenseId: string };

export async function ensureCompanionLicense(input: { productKey: string; buyerId: string; providerRef: string; expiresAt: Date | null }): Promise<CompanionResult> {
  const row = await prisma.rewardProduct.findUnique({ where: { key: input.productKey }, select: { mt4ListingId: true } }).catch(() => null);
  if (!row?.mt4ListingId) return { issued: false, reason: "NONE" };
  const listing = await prisma.marketplaceListing.findFirst({ where: { id: row.mt4ListingId, deletedAt: null } });
  if (!listing || !listing.tradingSystemId || !listing.versionId) return { issued: false, reason: "NO_RELEASE" };
  const release = await prisma.releaseArtifact.findFirst({
    where: { tradingSystemId: listing.tradingSystemId, versionId: listing.versionId, platform: listing.platformTag, releaseStatus: "PUBLISHED", deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!release) return { issued: false, reason: "NO_RELEASE" };
  const pricing = listing.pricing as Record<string, unknown> | null;
  const result = await issueLicenseForPurchase({
    buyerId: input.buyerId,
    marketplaceListingId: listing.id,
    tradingSystemId: listing.tradingSystemId,
    versionId: listing.versionId,
    releaseId: release.id,
    platform: listing.platformTag as PlatformName,
    amount: 0,
    currency: (pricing?.currency as string | undefined) ?? "USD",
    expiresAt: input.expiresAt,
    provider: "nowpayments",
    providerRef: `${input.providerRef}:p2`,
  });
  return { issued: true, duplicate: result.duplicate, licenseId: result.license.id };
}
