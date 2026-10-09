// services/marketplace/listingReportStore.ts
// Seller self-serve Phase 5: buyer reports + auto-suspend. DB logic only (no notifications here, so it can be tested by scripts);
// the routes send the bell notifications and write the audit log from the results returned below.
import { prisma } from "@/lib/prisma";
import { isPlatformOwner } from "@/lib/marketplace/selfServe";
import { shouldAutoSuspend, validateReport } from "@/lib/marketplace/reports";

export async function reportEligibility(listingId: string, userId: string): Promise<{ canReport: boolean; alreadyReported: boolean }> {
  const [paid, existing] = await Promise.all([
    prisma.purchase.count({ where: { buyerId: userId, marketplaceListingId: listingId, status: "COMPLETED", deletedAt: null } }),
    prisma.listingReport.count({ where: { listingId, reporterId: userId } }),
  ]);
  return { canReport: paid > 0, alreadyReported: existing > 0 };
}

export type SubmitResult =
  | { ok: true; suspended: false }
  | { ok: true; suspended: true; sellerId: string; title: string; slug: string; reporters: number }
  | { ok: false; code: string; message: string };

export async function submitReport(listingId: string, reporterId: string, input: { reason: unknown; details: unknown }): Promise<SubmitResult> {
  const invalid = validateReport(input);
  if (invalid) return { ok: false, code: "VALIDATION", message: invalid };
  const listing = await prisma.marketplaceListing.findFirst({ where: { id: listingId, deletedAt: null }, select: { id: true, sellerId: true, title: true, slug: true, publicationState: true } });
  if (!listing) return { ok: false, code: "NOT_FOUND", message: "Listing not found." };
  const elig = await reportEligibility(listingId, reporterId);
  if (!elig.canReport) return { ok: false, code: "NOT_A_BUYER", message: "Only buyers of this product can report it. For other concerns please contact support." };
  if (elig.alreadyReported) return { ok: false, code: "ALREADY_REPORTED", message: "You have already reported this listing. Thank you - we are looking at it." };

  await prisma.listingReport.create({ data: { listingId, reporterId, reason: String(input.reason), details: String(input.details).trim() } });

  const reporters = await prisma.listingReport.count({ where: { listingId, status: "OPEN" } });
  const seller = await prisma.user.findUnique({ where: { id: listing.sellerId }, select: { email: true } });
  const suspend = shouldAutoSuspend({ distinctOpenReporters: reporters, publicationState: listing.publicationState, sellerIsPlatformOwner: isPlatformOwner(seller?.email) });
  if (!suspend) return { ok: true, suspended: false };
  // The WHERE re-states the state so two simultaneous reports suspend once.
  const done = await prisma.marketplaceListing.updateMany({ where: { id: listingId, publicationState: { in: ["PUBLISHED", "READY"] } }, data: { publicationState: "SUSPENDED" } });
  if (done.count === 0) return { ok: true, suspended: false };
  return { ok: true, suspended: true, sellerId: listing.sellerId, title: listing.title, slug: listing.slug, reporters };
}

export interface AdminReportGroup {
  listingId: string;
  title: string;
  slug: string;
  publicationState: string;
  sellerEmail: string | null;
  openCount: number;
  reports: { id: string; reason: string; details: string; status: string; createdAt: string }[];
}

/** Listings that have open reports, or are suspended, newest report first. */
export async function adminReportGroups(): Promise<AdminReportGroup[]> {
  const open = await prisma.listingReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 500 });
  const suspended = await prisma.marketplaceListing.findMany({ where: { publicationState: "SUSPENDED", deletedAt: null }, select: { id: true } });
  const ids = Array.from(new Set([...open.map((r) => r.listingId), ...suspended.map((s) => s.id)]));
  if (ids.length === 0) return [];
  const listings = await prisma.marketplaceListing.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, slug: true, publicationState: true, sellerId: true } });
  const sellers = new Map((await prisma.user.findMany({ where: { id: { in: listings.map((l) => l.sellerId) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  return listings.map((l) => {
    const reports = open.filter((r) => r.listingId === l.id);
    return {
      listingId: l.id, title: l.title, slug: l.slug, publicationState: l.publicationState, sellerEmail: sellers.get(l.sellerId) ?? null, openCount: reports.length,
      reports: reports.map((r) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, createdAt: r.createdAt.toISOString() })),
    };
  });
}

/** restore: listing back to PUBLISHED, its open reports dismissed. retire: listing RETIRED, reports upheld, every build revoked. */
export async function resolveListing(listingId: string, action: "restore" | "retire"): Promise<{ ok: boolean; code?: string; sellerId?: string; title?: string }> {
  const listing = await prisma.marketplaceListing.findFirst({ where: { id: listingId, deletedAt: null }, select: { id: true, sellerId: true, title: true } });
  if (!listing) return { ok: false, code: "NOT_FOUND" };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.listingReport.updateMany({ where: { listingId, status: "OPEN" }, data: { status: action === "restore" ? "DISMISSED" : "UPHELD", resolvedAt: now } });
    await tx.marketplaceListing.update({ where: { id: listingId }, data: { publicationState: action === "restore" ? "PUBLISHED" : "RETIRED" } });
    if (action === "retire") await tx.releaseArtifact.updateMany({ where: { marketplaceListingId: listingId, releaseStatus: { not: "REVOKED" } }, data: { releaseStatus: "REVOKED" } });
  });
  return { ok: true, sellerId: listing.sellerId, title: listing.title };
}
