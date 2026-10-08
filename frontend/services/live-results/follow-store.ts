// services/live-results/follow-store.ts
// "Watch" (follow) a PUBLIC Live Results page so it shows up in the member's dashboard and updates by itself,
// and the small summary that a marketplace listing shows for the pages attached to it.
// Everything shown goes through loadResults, so the page owner's privacy settings always apply.

import { prisma } from "@/lib/prisma";
import { loadResults, liveResultsEnabled } from "./prisma-store";
import { MAX_FOLLOWS_PER_USER } from "./pages";

export interface WatchedItem {
  slug: string;
  /** False when the page is no longer public (or was deleted): kept in the list so the member can remove it. */
  available: boolean;
  title: string;
  mode: string | null;
  followedAt: number;
  daysSinceFirstSync: number | null;
  lastSyncAt: number | null;
  stale: boolean;
  /** Only trades closed after the member started watching. */
  sinceWatch: { trades: number; gainPct: number | null; winRatePct: number | null } | null;
  absoluteGainPct: number | null;
  maxDrawdownPct: number | null;
  todayGainPct: number | null;
  trades: number | null;
  /** The real forward record of the page (trades closed after its first sync). */
  liveTracked: { trades: number; gainPct: number | null } | null;
}

export type FollowResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "LIMIT"; message: string };

export async function followPage(userId: string, slug: string): Promise<FollowResult> {
  const page = await prisma.liveResultsPage.findUnique({ where: { slug }, select: { id: true, visibility: true } });
  if (!page || page.visibility !== "public") return { ok: false, code: "NOT_FOUND", message: "This page is not available to watch." };
  const existing = await prisma.liveResultsFollow.findUnique({ where: { userId_pageId: { userId, pageId: page.id } }, select: { id: true } });
  if (existing) return { ok: true };
  const count = await prisma.liveResultsFollow.count({ where: { userId } });
  if (count >= MAX_FOLLOWS_PER_USER) return { ok: false, code: "LIMIT", message: `You can watch up to ${MAX_FOLLOWS_PER_USER} pages. Stop watching one first.` };
  await prisma.liveResultsFollow.create({ data: { userId, pageId: page.id } }).catch(() => undefined); // a concurrent duplicate is fine
  return { ok: true };
}

export async function unfollowPage(userId: string, slug: string): Promise<boolean> {
  const page = await prisma.liveResultsPage.findUnique({ where: { slug }, select: { id: true } });
  if (!page) return false;
  const r = await prisma.liveResultsFollow.deleteMany({ where: { userId, pageId: page.id } });
  return r.count > 0;
}

export async function followedSlugs(userId: string): Promise<string[]> {
  const f = await prisma.liveResultsFollow.findMany({ where: { userId }, select: { pageId: true } });
  if (f.length === 0) return [];
  const pages = await prisma.liveResultsPage.findMany({ where: { id: { in: f.map((x) => x.pageId) } }, select: { slug: true } });
  return pages.map((p) => p.slug);
}

export async function isFollowing(userId: string, slug: string): Promise<boolean> {
  const page = await prisma.liveResultsPage.findUnique({ where: { slug }, select: { id: true } });
  if (!page) return false;
  return (await prisma.liveResultsFollow.count({ where: { userId, pageId: page.id } })) > 0;
}

export async function listWatching(userId: string): Promise<WatchedItem[]> {
  if (!liveResultsEnabled()) return [];
  const follows = await prisma.liveResultsFollow.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_FOLLOWS_PER_USER });
  if (follows.length === 0) return [];
  const pages = await prisma.liveResultsPage.findMany({ where: { id: { in: follows.map((f) => f.pageId) } }, select: { id: true, slug: true, title: true, visibility: true } });
  const byId = new Map(pages.map((p) => [p.id, p]));
  return Promise.all(
    follows.map(async (f): Promise<WatchedItem> => {
      const page = byId.get(f.pageId);
      const gone: WatchedItem = { slug: page?.slug ?? "", available: false, title: page?.title ?? "(removed page)", mode: null, followedAt: f.createdAt.getTime(), daysSinceFirstSync: null, lastSyncAt: null, stale: false, sinceWatch: null, absoluteGainPct: null, maxDrawdownPct: null, todayGainPct: null, trades: null, liveTracked: null };
      if (!page || page.visibility !== "public") return gone;
      const res = await loadResults(page.slug, { userId: null, key: null }, { sinceUtc: f.createdAt.getTime() });
      if (res.state !== "ok") return gone;
      const r = res.results;
      return {
        slug: page.slug,
        available: true,
        title: r.title,
        mode: r.mode,
        followedAt: f.createdAt.getTime(),
        daysSinceFirstSync: r.integrity.daysSinceFirstSync,
        lastSyncAt: r.integrity.lastSyncAt,
        stale: r.integrity.stale,
        sinceWatch: r.integrity.sinceWatch ? { trades: r.integrity.sinceWatch.trades, gainPct: r.integrity.sinceWatch.gainPct, winRatePct: r.integrity.sinceWatch.winRatePct } : null,
        absoluteGainPct: r.stats.absoluteGainPct,
        maxDrawdownPct: r.stats.maxDrawdownPct,
        todayGainPct: r.stats.daily.gainPct,
        trades: r.stats.trades,
        liveTracked: { trades: r.integrity.liveTracked.trades, gainPct: r.integrity.liveTracked.gainPct },
      };
    }),
  );
}

export interface ListingResultsSummary {
  slug: string;
  title: string;
  mode: string;
  daysSinceFirstSync: number;
  lastSyncAt: number;
  stale: boolean;
  filteredByMagic: boolean;
  liveTracked: { trades: number; gainPct: number | null; winRatePct: number | null };
  historyDays: number | null;
  maxDrawdownPct: number;
  edgeLevel: string | null;
}

/** Public pages attached to a marketplace listing (what the listing page shows). Never throws. */
export async function listingResults(listingSlug: string): Promise<ListingResultsSummary[]> {
  if (!liveResultsEnabled()) return [];
  try {
    const pages = await prisma.liveResultsPage.findMany({ where: { listingSlug, visibility: "public" }, orderBy: { publishedAt: "desc" }, take: 3, select: { slug: true } });
    const out: ListingResultsSummary[] = [];
    for (const p of pages) {
      const res = await loadResults(p.slug, { userId: null, key: null });
      if (res.state !== "ok") continue;
      const r = res.results;
      out.push({
        slug: p.slug,
        title: r.title,
        mode: r.mode,
        daysSinceFirstSync: r.integrity.daysSinceFirstSync,
        lastSyncAt: r.integrity.lastSyncAt,
        stale: r.integrity.stale,
        filteredByMagic: r.integrity.filteredByMagic !== null,
        liveTracked: r.integrity.liveTracked,
        historyDays: r.integrity.historyStart !== null ? Math.max(0, Math.round((r.integrity.firstSyncAt - r.integrity.historyStart) / 86_400_000)) : null,
        maxDrawdownPct: r.stats.maxDrawdownPct,
        edgeLevel: r.edge ? r.edge.level : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}
