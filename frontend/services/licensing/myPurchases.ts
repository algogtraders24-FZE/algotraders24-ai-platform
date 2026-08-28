// services/licensing/myPurchases.ts
// Sprint M13 (closing the marketplace delivery loop) - real, DB-backed
// reads for a buyer's OWN purchase/license history (Purchase ->
// Entitlement -> License -> Activation, the real M11 chain - see
// prisma/schema.prisma's own "Sprint M11" comment). Distinct from the
// pre-existing app/dashboard/licenses page, which reads mock data
// (data/licenses.ts) for an unrelated feature - never conflated with it.
import "server-only";
import { prisma } from "@/lib/prisma";

export interface MyPurchaseSummary {
  purchaseId: string;
  purchasedAt: string;
  amount: number;
  currency: string;
  status: string;
  listingTitle: string;
  listingSlug: string | null;
  licenseId: string | null;
  licenseStatus: string | null;
  platform: string | null;
}

export async function getMyPurchases(buyerId: string): Promise<MyPurchaseSummary[]> {
  const purchases = await prisma.purchase.findMany({
    where: { buyerId, deletedAt: null },
    orderBy: { purchasedAt: "desc" },
    include: { entitlements: { include: { licenses: true } } },
  });

  const listingIds = [...new Set(purchases.map((p) => p.marketplaceListingId))];
  const listings = await prisma.marketplaceListing.findMany({
    where: { id: { in: listingIds } },
    select: { id: true, title: true, slug: true },
  });
  const listingById = new Map(listings.map((l) => [l.id, l]));

  return purchases.map((p) => {
    const listing = listingById.get(p.marketplaceListingId);
    const license = p.entitlements[0]?.licenses[0];
    return {
      purchaseId: p.id,
      purchasedAt: p.purchasedAt.toISOString(),
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      listingTitle: listing?.title ?? "(listing no longer available)",
      listingSlug: listing?.slug ?? null,
      licenseId: license?.id ?? null,
      licenseStatus: license?.licenseStatus ?? null,
      platform: license?.platform ?? null,
    };
  });
}

export interface MyLicenseDetail {
  licenseId: string;
  buyerId: string;
  tradingSystemId: string;
  versionId: string;
  releaseId: string;
  platform: string;
  licenseStatus: string;
  issuedAt: string;
  expiresAt: string | null;
  activationPolicy: { maxActivations: number };
  listingTitle: string;
  listingSlug: string | null;
  activations: { id: string; deviceBindingId: string; deviceLabel: string; status: string; activatedAt: string; lastValidatedAt: string | null }[];
}

export async function getMyLicenseDetail(licenseId: string, buyerId: string): Promise<MyLicenseDetail | null> {
  const license = await prisma.license.findFirst({
    where: { id: licenseId, buyerId },
    include: { activations: true, entitlement: true },
  });
  if (!license) return null;

  const listing = await prisma.marketplaceListing.findUnique({
    where: { id: license.entitlement.marketplaceListingId },
    select: { title: true, slug: true },
  });

  return {
    licenseId: license.id,
    buyerId: license.buyerId,
    tradingSystemId: license.tradingSystemId,
    versionId: license.versionId,
    releaseId: license.releaseId,
    platform: license.platform,
    licenseStatus: license.licenseStatus,
    issuedAt: license.issuedAt.toISOString(),
    expiresAt: license.expiresAt?.toISOString() ?? null,
    activationPolicy: license.activationPolicy as unknown as { maxActivations: number },
    listingTitle: listing?.title ?? "(listing no longer available)",
    listingSlug: listing?.slug ?? null,
    activations: license.activations.map((a) => ({
      id: a.id,
      deviceBindingId: a.deviceBindingId,
      deviceLabel: a.deviceLabel,
      status: a.status,
      activatedAt: a.activatedAt.toISOString(),
      lastValidatedAt: a.lastValidatedAt?.toISOString() ?? null,
    })),
  };
}
