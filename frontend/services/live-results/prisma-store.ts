// services/live-results/prisma-store.ts
// DB layer for Live Results. Every read of another person's data goes through `loadResults`,
// which applies the viewing rule and then the privacy redaction in build.ts.

import { prisma } from "@/lib/prisma";
import type { WirePosition } from "../live-sync/contract";
import { buildPublicResults, type DealWithMagic, type PublicResults } from "./build";
import { dealsToHistory } from "../live-sync/to-trades";
import type { ClosedTrade } from "../edge-analyzer/types";
import { canView, slugWithSuffix, newUnlistedKey, MAX_PAGES_PER_USER, type PageInput } from "./pages";

const MAX_DEALS = 60_000;
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: ResultsLoad }>();

export function liveResultsEnabled(): boolean {
  return process.env.LIVE_RESULTS_ENABLED === "true";
}

export type ResultsLoad =
  | { state: "ok"; results: PublicResults; slug: string; visibility: string; isOwner: boolean; isAdmin: boolean }
  | { state: "not_found" };

/** All synced deals of an account (oldest first), shaped for the view builder. */
async function fetchDeals(accountId: string): Promise<DealWithMagic[]> {
  const rows = await prisma.liveSyncDeal.findMany({
    where: { accountId },
    orderBy: { timeMsc: "asc" },
    take: MAX_DEALS,
    select: { positionId: true, timeMsc: true, symbol: true, type: true, entry: true, volume: true, price: true, commission: true, swap: true, profit: true, fee: true, comment: true, magic: true },
  });
  return rows.map((r) => ({
    positionId: r.positionId.toString(),
    timeMsc: Number(r.timeMsc),
    symbol: r.symbol,
    type: r.type,
    entry: r.entry,
    volume: r.volume,
    price: r.price,
    commission: r.commission,
    swap: r.swap,
    profit: r.profit,
    fee: r.fee,
    comment: r.comment,
    magic: r.magic.toString(),
  }));
}

/** The OWNER's own closed trades for a page (magic filter applied), with amounts. Null if the page is not theirs. */
export async function loadOwnerTrades(userId: string, pageId: string): Promise<{ slug: string; trades: ClosedTrade[] } | null> {
  const page = await prisma.liveResultsPage.findFirst({ where: { id: pageId, userId } });
  if (!page) return null;
  const account = await prisma.liveSyncAccount.findFirst({ where: { id: page.accountId, userId }, select: { id: true } });
  if (!account) return null;
  const deals = await fetchDeals(account.id);
  const magic = page.magicFilter === null ? null : page.magicFilter.toString();
  const opens = new Map<string, string>();
  for (const d of deals) if (d.entry === "in" && !opens.has(d.positionId)) opens.set(d.positionId, d.magic);
  const kept = magic === null ? deals : deals.filter((d) => d.type === "balance" || opens.get(d.positionId) === magic);
  return { slug: page.slug, trades: dealsToHistory(kept).trades };
}

export async function loadResults(slug: string, viewer: { userId: string | null; key: string | null; isAdmin?: boolean }, opts: { sinceUtc?: number } = {}): Promise<ResultsLoad> {
  if (!liveResultsEnabled()) return { state: "not_found" };
  try {
    const page = await prisma.liveResultsPage.findUnique({ where: { slug } });
    if (!page) return { state: "not_found" };
    const isOwner = viewer.userId !== null && viewer.userId === page.userId;
    const isAdmin = viewer.isAdmin === true;
    if (!canView(page, { isOwner: isOwner || isAdmin, key: viewer.key })) return { state: "not_found" };

    const ck = `${slug}|${page.updatedAt.getTime()}|${isOwner || isAdmin ? "o" : "v"}|${opts.sinceUtc ?? ""}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

    const account = await prisma.liveSyncAccount.findFirst({ where: { id: page.accountId, userId: page.userId } });
    if (!account) return { state: "not_found" };

    const deals = await fetchDeals(account.id);
    const snaps = await prisma.liveSyncSnapshot.findMany({
      where: { accountId: account.id, timeUtc: { gte: new Date(Date.now() - 2 * 86_400_000) } },
      orderBy: { timeUtc: "desc" },
      take: 300,
      select: { timeUtc: true, positions: true },
    });

    const results = buildPublicResults({
      page: { title: page.title, description: page.description, showAmounts: page.showAmounts, positionDelayMin: page.positionDelayMin, magicFilter: page.magicFilter === null ? null : page.magicFilter.toString() },
      account: {
        mode: account.mode,
        currency: account.currency,
        marginMode: account.marginMode,
        leverage: account.leverage,
        serverUtcOffsetSec: account.serverUtcOffsetSec,
        firstSyncAt: account.firstSyncAt.getTime(),
        lastSyncAt: account.lastSyncAt.getTime(),
        batches: account.chainSeq,
        chainHead: account.chainHead,
      },
      deals,
      snapshots: snaps.map((s) => ({ time: s.timeUtc.getTime(), positions: Array.isArray(s.positions) ? (s.positions as unknown as WirePosition[]) : [] })),
      nowUtc: Date.now(),
      sinceUtc: opts.sinceUtc,
    });
    const value: ResultsLoad = { state: "ok", results, slug: page.slug, visibility: page.visibility, isOwner, isAdmin };
    cache.set(ck, { at: Date.now(), value });
    if (cache.size > 200) cache.clear();
    return value;
  } catch {
    return { state: "not_found" };
  }
}

export interface OwnerPage {
  id: string;
  accountId: string;
  slug: string;
  title: string;
  description: string;
  visibility: string;
  unlistedKey: string;
  magicFilter: string | null;
  showAmounts: boolean;
  positionDelayMin: number;
  listingSlug: string | null;
  updatedAt: Date;
}

const toOwnerPage = (p: { id: string; accountId: string; slug: string; title: string; description: string; visibility: string; unlistedKey: string; magicFilter: bigint | null; showAmounts: boolean; positionDelayMin: number; listingSlug: string | null; updatedAt: Date }): OwnerPage => ({
  id: p.id,
  accountId: p.accountId,
  slug: p.slug,
  title: p.title,
  description: p.description,
  visibility: p.visibility,
  unlistedKey: p.unlistedKey,
  magicFilter: p.magicFilter === null ? null : p.magicFilter.toString(),
  showAmounts: p.showAmounts,
  positionDelayMin: p.positionDelayMin,
  listingSlug: p.listingSlug,
  updatedAt: p.updatedAt,
});

export async function listOwnerPages(userId: string): Promise<OwnerPage[]> {
  const rows = await prisma.liveResultsPage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map(toOwnerPage);
}

/** Magic numbers present on an account (from opening deals), so the owner can pick one EA. */
export async function listAccountMagics(userId: string, accountIds: string[]): Promise<Record<string, { magic: string; trades: number }[]>> {
  if (accountIds.length === 0) return {};
  const owned = await prisma.liveSyncAccount.findMany({ where: { userId, id: { in: accountIds } }, select: { id: true } });
  const ids = owned.map((a) => a.id);
  const g = await prisma.liveSyncDeal.groupBy({ by: ["accountId", "magic"], where: { accountId: { in: ids }, entry: "in", type: { in: ["buy", "sell"] } }, _count: { _all: true } });
  const out: Record<string, { magic: string; trades: number }[]> = {};
  for (const r of g) (out[r.accountId] ??= []).push({ magic: r.magic.toString(), trades: r._count._all });
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.trades - a.trades);
  return out;
}

/** A page may be shown on a marketplace listing only by the seller of that listing. */
async function ownsListing(userId: string, slug: string | null): Promise<boolean> {
  if (slug === null) return true;
  const l = await prisma.marketplaceListing.findFirst({ where: { slug, sellerId: userId, deletedAt: null }, select: { id: true } });
  return l !== null;
}

/** The seller's own listings that a results page can be attached to. */
export async function listSellerListings(userId: string): Promise<{ slug: string; title: string }[]> {
  const rows = await prisma.marketplaceListing.findMany({ where: { sellerId: userId, deletedAt: null, publicationState: { in: ["PUBLISHED", "READY"] } }, select: { slug: true, title: true }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows;
}

export type SaveResult = { ok: true; page: OwnerPage } | { ok: false; code: "ACCOUNT_NOT_FOUND" | "PAGE_LIMIT" | "NOT_FOUND" | "LISTING_NOT_FOUND"; message: string };

export async function createPage(userId: string, input: PageInput): Promise<SaveResult> {
  const account = await prisma.liveSyncAccount.findFirst({ where: { id: input.accountId, userId }, select: { id: true } });
  if (!account) return { ok: false, code: "ACCOUNT_NOT_FOUND", message: "Account not found" };
  const count = await prisma.liveResultsPage.count({ where: { userId } });
  if (count >= MAX_PAGES_PER_USER) return { ok: false, code: "PAGE_LIMIT", message: `You can have at most ${MAX_PAGES_PER_USER} results pages.` };
  if (!(await ownsListing(userId, input.listingSlug))) return { ok: false, code: "LISTING_NOT_FOUND", message: "You can only attach a page to a marketplace listing you sell." };
  const row = await prisma.liveResultsPage.create({
    data: {
      userId,
      accountId: account.id,
      slug: slugWithSuffix(input.title),
      title: input.title,
      description: input.description,
      visibility: input.visibility,
      unlistedKey: newUnlistedKey(),
      magicFilter: input.magicFilter === null ? null : BigInt(input.magicFilter),
      showAmounts: input.showAmounts,
      positionDelayMin: input.positionDelayMin,
      listingSlug: input.listingSlug,
      publishedAt: input.visibility === "private" ? null : new Date(),
    },
  });
  return { ok: true, page: toOwnerPage(row) };
}

export async function updatePage(userId: string, id: string, input: PageInput): Promise<SaveResult> {
  const existing = await prisma.liveResultsPage.findFirst({ where: { id, userId } });
  if (!existing) return { ok: false, code: "NOT_FOUND", message: "Page not found" };
  if (!(await ownsListing(userId, input.listingSlug))) return { ok: false, code: "LISTING_NOT_FOUND", message: "You can only attach a page to a marketplace listing you sell." };
  const row = await prisma.liveResultsPage.update({
    where: { id },
    data: {
      title: input.title,
      description: input.description,
      visibility: input.visibility,
      magicFilter: input.magicFilter === null ? null : BigInt(input.magicFilter),
      showAmounts: input.showAmounts,
      positionDelayMin: input.positionDelayMin,
      listingSlug: input.listingSlug,
      publishedAt: input.visibility === "private" ? null : existing.publishedAt ?? new Date(),
    },
  });
  return { ok: true, page: toOwnerPage(row) };
}

/** New secret link: the old unlisted link stops working immediately. */
export async function rotateKey(userId: string, id: string): Promise<OwnerPage | null> {
  const existing = await prisma.liveResultsPage.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return toOwnerPage(await prisma.liveResultsPage.update({ where: { id }, data: { unlistedKey: newUnlistedKey() } }));
}

export async function deletePage(userId: string, id: string): Promise<boolean> {
  const r = await prisma.liveResultsPage.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

// ---------------------------------------------------------------------------
// Directory (every signed-in user) and admin moderation.
// The directory lists PUBLIC pages only and deliberately shows no performance number: it is a
// "find a page" list, not a ranking (ranking by gain rewards risk-taking and gaming).
// ---------------------------------------------------------------------------

export interface DirectoryItem {
  slug: string;
  title: string;
  description: string;
  mode: string;
  daysSinceFirstSync: number;
  lastSyncAt: number;
  stale: boolean;
  oneEa: boolean;
}

export async function listPublicDirectory(): Promise<DirectoryItem[]> {
  const pages = await prisma.liveResultsPage.findMany({ where: { visibility: "public" }, orderBy: { publishedAt: "desc" }, take: 100 });
  if (pages.length === 0) return [];
  const accounts = await prisma.liveSyncAccount.findMany({ where: { id: { in: pages.map((p) => p.accountId) } }, select: { id: true, userId: true, mode: true, firstSyncAt: true, lastSyncAt: true } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const now = Date.now();
  const out: DirectoryItem[] = [];
  for (const p of pages) {
    const a = byId.get(p.accountId);
    if (!a || a.userId !== p.userId) continue;
    out.push({
      slug: p.slug,
      title: p.title,
      description: p.description,
      mode: a.mode,
      daysSinceFirstSync: Math.max(0, Math.floor((now - a.firstSyncAt.getTime()) / 86_400_000)),
      lastSyncAt: a.lastSyncAt.getTime(),
      stale: now - a.lastSyncAt.getTime() > 10 * 60_000,
      oneEa: p.magicFilter !== null,
    });
  }
  return out;
}

export interface AdminPageRow {
  id: string;
  slug: string;
  title: string;
  visibility: string;
  ownerEmail: string;
  accountLabel: string;
  mode: string;
  magicFilter: string | null;
  showAmounts: boolean;
  createdAt: number;
  lastSyncAt: number | null;
}

export async function adminListAll(): Promise<AdminPageRow[]> {
  const pages = await prisma.liveResultsPage.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  if (pages.length === 0) return [];
  const [accounts, users] = await Promise.all([
    prisma.liveSyncAccount.findMany({ where: { id: { in: pages.map((p) => p.accountId) } }, select: { id: true, accountKey: true, mode: true, lastSyncAt: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(pages.map((p) => p.userId))] } }, select: { id: true, email: true } }),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const usr = new Map(users.map((u) => [u.id, u.email]));
  return pages.map((p) => {
    const a = acc.get(p.accountId);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      visibility: p.visibility,
      ownerEmail: usr.get(p.userId) ?? "(unknown)",
      accountLabel: a ? `Account ${a.accountKey.slice(0, 6)}` : "(missing)",
      mode: a?.mode ?? "-",
      magicFilter: p.magicFilter === null ? null : p.magicFilter.toString(),
      showAmounts: p.showAmounts,
      createdAt: p.createdAt.getTime(),
      lastSyncAt: a ? a.lastSyncAt.getTime() : null,
    };
  });
}

/** Moderation: take a page down without deleting the owner's settings. Returns the previous visibility, or null if not found. */
export async function adminMakePrivate(id: string): Promise<string | null> {
  const p = await prisma.liveResultsPage.findUnique({ where: { id }, select: { visibility: true } });
  if (!p) return null;
  await prisma.liveResultsPage.update({ where: { id }, data: { visibility: "private", publishedAt: null } });
  return p.visibility;
}

export async function adminDelete(id: string): Promise<boolean> {
  const r = await prisma.liveResultsPage.deleteMany({ where: { id } });
  return r.count > 0;
}
