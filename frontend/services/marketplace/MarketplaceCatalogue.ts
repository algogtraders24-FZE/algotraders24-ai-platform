// services/marketplace/MarketplaceCatalogue.ts
// Sprint M8 - Server-side marketplace catalogue reads. Same architectural
// role as services/products/ProductCatalogue.ts (public pages are Server
// Components and query Prisma directly), extended with real search/
// filter/sort/pagination since the catalog must scale to 100-500+ listings
// (M8 brief section 21/22) without loading full Evidence/Validation/Risk/
// History artifacts on the catalog page - see types/marketplace.ts for why
// MarketplaceListingSummary stays lightweight.
//
// Only PUBLICLY_VISIBLE_STATES (READY, PUBLISHED) are ever returned to
// public callers - DRAFT/SUBMITTED/UNDER_REVIEW/etc. listings never leak
// into the public catalog or detail page, regardless of filters.
import "server-only";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "./tableGuard";
import type { MarketplaceListing as PrismaMarketplaceListing } from "@/lib/generated/prisma/client";
import {
  PUBLICLY_VISIBLE_STATES,
  type ListingPricing,
  type MarketplaceListingDetail,
  type MarketplaceListingSummary,
  type MarketplaceSearchParams,
  type MarketplaceSearchResult,
  type PublicationState,
  type TrustState,
} from "@/types/marketplace";

function parsePricing(json: unknown): ListingPricing {
  if (json && typeof json === "object" && "model" in json) {
    const p = json as Record<string, unknown>;
    const model = p.model;
    if (model === "one_time" || model === "subscription" || model === "free" || model === "unavailable") {
      return {
        model,
        amount: typeof p.amount === "number" ? p.amount : undefined,
        currency: typeof p.currency === "string" ? p.currency : undefined,
        interval: p.interval === "month" || p.interval === "year" ? p.interval : undefined,
      };
    }
  }
  return { model: "unavailable" };
}

function toSummary(row: PrismaMarketplaceListing, sellerNames: Map<string, string>): MarketplaceListingSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    sellerId: row.sellerId,
    sellerName: sellerNames.get(row.sellerId) ?? null,
    category: row.category,
    platformTag: row.platformTag,
    assetTag: row.assetTag,
    tags: row.tags,
    pricing: parsePricing(row.pricing),
    trustState: (row.trustState as TrustState | null) ?? null,
    trustReasonCode: row.trustReasonCode,
    publicationState: row.publicationState as PublicationState,
    versionId: row.versionId,
    lastEvidenceAt: row.lastEvidenceAt ? row.lastEvidenceAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    media: row.media,
  };
}

function rowToDetail(row: PrismaMarketplaceListing, sellerNames: Map<string, string>): MarketplaceListingDetail {
  const summary = toSummary(row, sellerNames);
  // Evidence/Validation/Risk/History sections: this listing has no
  // ingestion path wiring it to the real M2-M7 artifacts yet (see
  // M8_entity_relationship.md section 3) - always null this sprint. The
  // detail page renders each section's own honest "unavailable" state
  // rather than fabricating placeholder numbers.
  return {
    ...summary,
    tradingSystemId: row.tradingSystemId,
    trustExplanation: row.trustExplanation || null,
    trustInfo:
      row.trustState && row.trustReasonCode
        ? {
            status: row.trustState as TrustState,
            reasonCode: row.trustReasonCode,
            explanation: row.trustExplanation || "",
            generatedAt: row.updatedAt.toISOString(),
          }
        : null,
    evidence: null,
    validation: null,
    risk: null,
    history: null,
  };
}

async function resolveSellerNames(sellerIds: string[]): Promise<Map<string, string>> {
  if (sellerIds.length === 0) return new Map();
  const unique = Array.from(new Set(sellerIds));
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

function sortToOrderBy(sort: MarketplaceSearchParams["sort"]) {
  switch (sort) {
    case "recently_updated":
      return [{ updatedAt: "desc" as const }];
    case "price_asc":
    case "price_desc":
      // Price lives inside the `pricing` Json blob (model-dependent shape),
      // not a queryable column - Postgres/Prisma can't sort JSON paths of
      // mixed shape here without a generated column. Falls back to newest
      // first rather than silently returning an unsorted/wrong order; a
      // real numeric `priceAmount` column is a reasonable future addition
      // once real pricing data exists to sort by.
      return [{ createdAt: "desc" as const }];
    case "most_recent_evidence":
      return [{ lastEvidenceAt: "desc" as const }, { createdAt: "desc" as const }];
    case "most_evidence":
      // No evidence-count column exists (would require aggregating the
      // authoritative M2-M7 artifacts, out of scope this sprint - see
      // M8_entity_relationship.md section 3). Falls back to newest.
      return [{ createdAt: "desc" as const }];
    case "newest":
    default:
      return [{ createdAt: "desc" as const }];
  }
}

export class MarketplaceCatalogue {
  static async search(params: MarketplaceSearchParams): Promise<MarketplaceSearchResult> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 24));

    const where = {
      deletedAt: null,
      publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] },
      ...(params.platform ? { platformTag: params.platform } : {}),
      ...(params.asset ? { assetTag: params.asset } : {}),
      ...(params.strategy ? { category: params.strategy } : {}),
      ...(params.trustState ? { trustState: params.trustState } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: "insensitive" as const } },
              { description: { contains: params.q, mode: "insensitive" as const } },
              { tags: { has: params.q } },
              { platformTag: { contains: params.q, mode: "insensitive" as const } },
              { category: { contains: params.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await withTableFallback(
      () =>
        Promise.all([
          prisma.marketplaceListing.findMany({
            where,
            orderBy: sortToOrderBy(params.sort),
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.marketplaceListing.count({ where }),
        ]),
      [[], 0] as [PrismaMarketplaceListing[], number],
    );

    const sellerNames = await resolveSellerNames(rows.map((r) => r.sellerId));
    return { items: rows.map((r) => toSummary(r, sellerNames)), total, page, pageSize };
  }

  static async getBySlug(slug: string): Promise<MarketplaceListingDetail | null> {
    const row = await withTableFallback(
      () =>
        prisma.marketplaceListing.findFirst({
          where: { slug, deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } },
        }),
      null,
    );
    if (!row) return null;

    const sellerNames = await resolveSellerNames([row.sellerId]);
    return rowToDetail(row, sellerNames);
  }

  // Owner-only preview read - deliberately does NOT filter by
  // publicationState (a seller must be able to preview their own DRAFT
  // listing before it's publicly reachable), but DOES require sellerId to
  // match the caller, same ownership pattern as the PATCH/media routes.
  // Never exposed to unauthenticated callers - see
  // app/marketplace/preview/[id]/page.tsx, the only caller.
  static async getByIdForOwner(id: string, sellerId: string): Promise<MarketplaceListingDetail | null> {
    const row = await withTableFallback(
      () => prisma.marketplaceListing.findFirst({ where: { id, sellerId, deletedAt: null } }),
      null,
    );
    if (!row) return null;

    const sellerNames = await resolveSellerNames([row.sellerId]);
    return rowToDetail(row, sellerNames);
  }

  // Owner-only: every one of the caller's own listings regardless of
  // publicationState, lightweight (Summary shape) - used by the homepage
  // preview page (app/marketplace/preview/homepage/page.tsx), same
  // ownership-only gate as getByIdForOwner.
  static async listAllForOwner(sellerId: string): Promise<MarketplaceListingSummary[]> {
    const rows = await withTableFallback(
      () => prisma.marketplaceListing.findMany({ where: { sellerId, deletedAt: null }, orderBy: { updatedAt: "desc" } }),
      [] as PrismaMarketplaceListing[],
    );
    const sellerNames = await resolveSellerNames(rows.map((r) => r.sellerId));
    return rows.map((r) => toSummary(r, sellerNames));
  }

  static async getAllSlugs(): Promise<string[]> {
    const rows = await withTableFallback(
      () =>
        prisma.marketplaceListing.findMany({
          where: { deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } },
          select: { slug: true },
        }),
      [] as { slug: string }[],
    );
    return rows.map((r) => r.slug);
  }

  static async getFilterFacets(): Promise<{ platforms: string[]; assets: string[]; strategies: string[] }> {
    const where = { deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } };
    const [platforms, assets, strategies] = await withTableFallback(
      () =>
        Promise.all([
          prisma.marketplaceListing.findMany({ where, select: { platformTag: true }, distinct: ["platformTag"] }),
          prisma.marketplaceListing.findMany({ where, select: { assetTag: true }, distinct: ["assetTag"] }),
          prisma.marketplaceListing.findMany({ where, select: { category: true }, distinct: ["category"] }),
        ]),
      [[], [], []] as [{ platformTag: string }[], { assetTag: string }[], { category: string }[]],
    );
    return {
      platforms: platforms.map((p) => p.platformTag).filter(Boolean),
      assets: assets.map((a) => a.assetTag).filter(Boolean),
      strategies: strategies.map((s) => s.category).filter(Boolean),
    };
  }
}
