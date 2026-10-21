// services/trial/trialService.ts
// The 30-day free DEMO of a product. A trial is a normal licence (so download, key reveal, account binding, expiry and the licence
// check all work unchanged): Purchase(provider "TRIAL", amount 0) -> Entitlement -> License(expiresAt = now + 30 days) for the product's
// separate DEMO release. Rules: one trial per user per product, email must be verified, and the licence check only accepts a trial key
// from the demo build (see checkLicenseByKey), which itself refuses real accounts.
import "server-only";
import { prisma } from "@/lib/prisma";
import { issueLicenseForPurchase } from "@/services/licensing/licenseService";

export const TRIAL_DAYS = 30;
/** A global safety brake so a script cannot mint thousands of trials in a day. */
export const DAILY_TRIAL_CAP = 300;

export interface TrialProduct {
  title: string;
  listingSlug: string;
  /** versionId of the DEMO ReleaseArtifact (different from the paid release, so a purchase never picks the demo build). */
  demoVersionId: string;
}

export const TRIAL_PRODUCTS: Record<string, TrialProduct> = {
  XXXUS30: { title: "XXX US30", listingSlug: "xxx-us30-multi-module-breakout", demoVersionId: "XXXUS30-DEMO-v1.03" },
};

export type StartTrialResult =
  | { ok: true; licenseId: string; expiresAt: string; already: boolean }
  | { ok: false; code: "UNKNOWN_PRODUCT" | "UNAVAILABLE" | "BUSY" | "NOT_VERIFIED"; message: string };

export async function startTrial(user: { id: string; emailVerified: boolean }, productId: string, now: Date = new Date()): Promise<StartTrialResult> {
  const product = TRIAL_PRODUCTS[productId];
  if (!product) return { ok: false, code: "UNKNOWN_PRODUCT", message: "This product has no free demo." };
  if (!user.emailVerified) return { ok: false, code: "NOT_VERIFIED", message: "Please verify your email address first, then start the demo." };

  const existing = await prisma.purchase.findFirst({
    where: { buyerId: user.id, tradingSystemId: productId, provider: "TRIAL", deletedAt: null },
    include: { entitlements: { include: { licenses: true } } },
  });
  const existingLicense = existing?.entitlements[0]?.licenses[0];
  if (existingLicense) {
    return { ok: true, licenseId: existingLicense.id, expiresAt: (existingLicense.expiresAt ?? now).toISOString(), already: true };
  }

  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const recent = await prisma.purchase.count({ where: { provider: "TRIAL", createdAt: { gte: since } } });
  if (recent >= DAILY_TRIAL_CAP) return { ok: false, code: "BUSY", message: "A lot of people are starting the demo right now. Please try again in a few hours." };

  const [listing, release] = await Promise.all([
    prisma.marketplaceListing.findFirst({ where: { slug: product.listingSlug, deletedAt: null, publicationState: "PUBLISHED" }, select: { id: true } }),
    prisma.releaseArtifact.findFirst({ where: { tradingSystemId: productId, versionId: product.demoVersionId, platform: "MT5", releaseStatus: "PUBLISHED", deletedAt: null } }),
  ]);
  if (!listing || !release) return { ok: false, code: "UNAVAILABLE", message: "The demo is not available right now. Please try again later." };

  const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 3600 * 1000);
  const res = await issueLicenseForPurchase({
    buyerId: user.id,
    marketplaceListingId: listing.id,
    tradingSystemId: productId,
    versionId: release.versionId,
    releaseId: release.id,
    platform: "MT5",
    amount: 0,
    currency: "USD",
    expiresAt,
    provider: "TRIAL",
    providerRef: `TRIAL-${user.id}-${productId}`, // unique: a double click or a race returns the same licence
  });
  return { ok: true, licenseId: res.license.id, expiresAt: (res.license.expiresAt ?? expiresAt).toISOString(), already: res.duplicate };
}
