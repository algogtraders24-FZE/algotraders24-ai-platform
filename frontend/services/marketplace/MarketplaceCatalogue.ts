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
import { verifiedSellerIds } from "@/services/marketplace/identityStore";
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "./tableGuard";
import type { MarketplaceListing as PrismaMarketplaceListing } from "@/lib/generated/prisma/client";
import {
  PUBLICLY_VISIBLE_STATES,
  type EvidenceSummary,
  type HistorySummary,
  type ListingPricing,
  type MarketplaceListingDetail,
  type MarketplaceListingSummary,
  type MarketplaceSearchParams,
  type MarketplaceSearchResult,
  type PublicationState,
  type RiskSummary,
  type TrustState,
  type ValidationSummary,
} from "@/types/marketplace";

// Real Evidence/Validation/Risk/History content for the detail page.
// Sprint M12 branding follow-on (Phase 2): DB-first, reading the real
// MarketplaceEvidenceRecord table (written only by scripts/load-
// marketplace-evidence.ts after an AT24 human runs the real M2-M7
// engines - sellers never write here). Falls back to the older flat-file
// convention (scripts/assemble-marketplace-evidence-content.ts's output)
// so a product only loaded as a file still works. Honestly returns null
// (never a guess) when neither exists yet.
const EVIDENCE_CONTENT_DIR = join(process.cwd(), "data", "marketplace-evidence");
function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9.-]/g, "_");
}
interface EvidenceContent {
  evidence: EvidenceSummary;
  validation: ValidationSummary;
  risk: RiskSummary;
  history: HistorySummary;
}
async function loadEvidenceContent(tradingSystemId: string | null, versionId: string | null): Promise<EvidenceContent | null> {
  if (!tradingSystemId || !versionId) return null;

  const row = await withTableFallback(
    () => prisma.marketplaceEvidenceRecord.findUnique({ where: { tradingSystemId_versionId: { tradingSystemId, versionId } } }),
    null,
  );
  if (row) {
    return {
      evidence: row.evidenceContent as unknown as EvidenceSummary,
      validation: row.validationContent as unknown as ValidationSummary,
      risk: row.riskContent as unknown as RiskSummary,
      history: row.historyContent as unknown as HistorySummary,
    };
  }

  try {
    const filename = `${safeFilenamePart(tradingSystemId)}__${safeFilenamePart(versionId)}.content.json`;
    const raw = readFileSync(join(EVIDENCE_CONTENT_DIR, filename), "utf-8");
    return JSON.parse(raw) as EvidenceContent;
  } catch {
    return null;
  }
}

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

// A listing can only ever be purchasable when a real PUBLISHED
// ReleaseArtifact exists for its exact tradingSystemId/versionId/platform -
// checked fresh here, never cached/assumed, so a purchase can never be
// offered for a product with nothing real to download.
async function findRealRelease(row: PrismaMarketplaceListing): Promise<string | null> {
  if (!row.tradingSystemId || !row.versionId) return null;
  const release = await withTableFallback(
    () =>
      prisma.releaseArtifact.findFirst({
        where: { tradingSystemId: row.tradingSystemId!, versionId: row.versionId!, platform: row.platformTag, releaseStatus: "PUBLISHED", deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      }),
    null,
  );
  return release?.id ?? null;
}

async function rowToDetail(row: PrismaMarketplaceListing, sellerNames: Map<string, string>): Promise<MarketplaceListingDetail> {
  const summary = toSummary(row, sellerNames);
  const releaseId = await findRealRelease(row);
  // Evidence/Validation/Risk/History sections: real content when an AT24
  // human has run this tradingSystemId/versionId through the real M2-M7
  // chain and assembled it (scripts/assemble-marketplace-evidence-
  // content.ts) - honestly null otherwise. The detail page renders each
  // section's own honest "unavailable" state rather than fabricating
  // placeholder numbers when nothing exists yet.
  const content = await loadEvidenceContent(row.tradingSystemId, row.versionId);
  return {
    ...summary,
    tradingSystemId: row.tradingSystemId,
    releaseId,
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
    evidence: content?.evidence ?? null,
    validation: content?.validation ?? null,
    risk: content?.risk ?? null,
    history: content?.history ?? null,
  };
}

const PLATFORM_SELLER_DISPLAY_NAME = "Algotraders24.ai";
const PLATFORM_SELLER_EMAILS = new Set(["algogtraders24@gmail.com", "pravinawari@outlook.com"]);

async function resolveSellerNames(sellerIds: string[]): Promise<Map<string, string>> {
  if (sellerIds.length === 0) return new Map();
  const unique = Array.from(new Set(sellerIds));
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  // Listings published from the platform owner's own account are shown under the platform brand, not the
  // owner's personal name (the account's real name is unchanged everywhere else in the product).
  return new Map(users.map((u) => [u.id, PLATFORM_SELLER_EMAILS.has((u.email ?? "").toLowerCase()) ? PLATFORM_SELLER_DISPLAY_NAME : u.name]));
}

// Default marketplace order leads with the most-trusted real listings -
// VALIDATED first, then LIMITED, then the rest of the real M7 vocabulary
// in roughly descending trustworthiness, newest-first within each tier.
// trustState is a plain string column (not a Postgres enum - see the
// model comment), so Prisma's typed `orderBy` can't express this custom
// priority directly; at the current catalog scale (dozens of listings,
// not yet the 100-500+ this file's own header anticipates) sorting the
// full result set in application code is simpler and cheaper than a raw
// SQL CASE expression, and easy to switch to one if the catalog grows
// enough for that to matter.
const TRUST_STATE_PRIORITY: Record<string, number> = {
  VALIDATED: 0,
  LIMITED: 1,
  UNDER_OBSERVATION: 2,
  VALIDATION_PENDING: 3,
  INCONCLUSIVE: 4,
  UNVERIFIED: 5,
  INVALIDATED: 6,
  SUPERSEDED: 7,
};
const UNKNOWN_TRUST_STATE_PRIORITY = 8; // null/missing/unrecognized - sinks to the bottom, never guessed into a real tier

function trustPriorityOf(trustState: string | null): number {
  if (!trustState) return UNKNOWN_TRUST_STATE_PRIORITY;
  return TRUST_STATE_PRIORITY[trustState] ?? UNKNOWN_TRUST_STATE_PRIORITY;
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
      // Found during Beta User Testing (2026-09-29): without an explicit
      // nulls position, PostgreSQL's own default for DESC is NULLS FIRST -
      // meaning listings with NO evidence at all (lastEvidenceAt: null,
      // e.g. a fresh UNVERIFIED submission) would rank ABOVE genuinely
      // evidenced ones under this exact sort, the opposite of what
      // "Most Recent Evidence" promises. Explicit nulls: "last" fixes this
      // regardless of database default.
      return [{ lastEvidenceAt: { sort: "desc" as const, nulls: "last" as const } }, { createdAt: "desc" as const }];
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

    // No explicit sort = the marketplace's own default order, which leads
    // with VALIDATED products (see TRUST_STATE_PRIORITY above) - every
    // other sort is a user-chosen override and keeps the plain DB-level
    // ordering untouched.
    const useTrustPriorityOrder = !params.sort || params.sort === "newest";

    const [rows, total] = await withTableFallback(
      async () => {
        if (useTrustPriorityOrder) {
          const all = await prisma.marketplaceListing.findMany({ where });
          all.sort((a, b) => {
            const byTrust = trustPriorityOf(a.trustState) - trustPriorityOf(b.trustState);
            if (byTrust !== 0) return byTrust;
            return b.createdAt.getTime() - a.createdAt.getTime();
          });
          return [all.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), all.length] as [PrismaMarketplaceListing[], number];
        }
        return Promise.all([
          prisma.marketplaceListing.findMany({
            where,
            orderBy: sortToOrderBy(params.sort),
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.marketplaceListing.count({ where }),
        ]);
      },
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
    const detail = await rowToDetail(row, sellerNames);
    return { ...detail, sellerIdentityVerified: (await verifiedSellerIds([row.sellerId])).has(row.sellerId) };
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
