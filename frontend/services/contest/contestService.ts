// services/contest/contestService.ts
// The demo contest: enter, leaderboard, finalize (winners + prize licences). Scoring itself is the pure module standings.ts.
// Admin load is one click: "Finalize" freezes the standings, picks the top 3 ELIGIBLE entrants (one prize per person across contests)
// and issues each of them a prize licence of the paid product; everything else is automatic.
import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchDeals } from "@/services/live-results/prisma-store";
import { issueLicenseForPurchase } from "@/services/licensing/licenseService";
import { createPaymentLink } from "@/services/marketplace/paymentLinkService";
import { getSiteUrl } from "@/lib/payments/env";
import { TRIAL_PRODUCTS } from "@/services/trial/trialService";
import { cleanAlias, computeStanding, rankStandings, readContestRules, type Standing } from "./standings";

export interface PublicRow {
  rank: number | null;
  alias: string;
  profitPct: number | null;
  trades: number;
  tradingDays: number;
  worstDailyLossPct: number;
  maxLossUsedPct: number;
  eligible: boolean;
  note: string | null;
}

interface Scored {
  entryId: string;
  userId: string;
  alias: string;
  standing: Standing;
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; rows: Scored[] }>();

async function scoreEntries(contestId: string, fresh: boolean): Promise<Scored[]> {
  const hit = cache.get(contestId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const contest = await prisma.contest.findUnique({ where: { id: contestId }, include: { entries: true } });
  if (!contest) return [];
  const rules = readContestRules(contest.rules);
  const window = { startMs: contest.startsAt.getTime(), endMs: contest.endsAt.getTime() };
  const out: Scored[] = [];
  // small batches: each entrant's deals are one query
  for (let i = 0; i < contest.entries.length; i += 5) {
    const batch = contest.entries.slice(i, i + 5);
    const rows = await Promise.all(
      batch.map(async (e) => {
        const account = await prisma.liveSyncAccount.findFirst({ where: { id: e.accountId, userId: e.userId }, select: { id: true, marginMode: true } });
        if (!account) return { entryId: e.id, userId: e.userId, alias: e.alias, standing: { ...computeStanding([], "hedging", window, contest.magic, rules), reason: "Live Sync account not found" } };
        const deals = await fetchDeals(account.id);
        return { entryId: e.id, userId: e.userId, alias: e.alias, standing: computeStanding(deals, account.marginMode, window, contest.magic, rules) };
      }),
    );
    out.push(...rows);
  }
  cache.set(contestId, { at: Date.now(), rows: out });
  return out;
}

const toPublic = (r: { rank: number | null; row: Scored; standing: Standing }): PublicRow => ({
  rank: r.rank,
  alias: r.row.alias,
  profitPct: r.standing.scored ? r.standing.profitPct : null,
  trades: r.standing.trades,
  tradingDays: r.standing.tradingDays,
  worstDailyLossPct: r.standing.worstDailyLossPct,
  maxLossUsedPct: r.standing.maxLossUsedPct,
  eligible: r.standing.eligible,
  note: r.standing.reason,
});

export async function getContest(slug: string) {
  return prisma.contest.findUnique({ where: { slug } });
}

export async function publicLeaderboard(contestId: string, fresh = false): Promise<PublicRow[]> {
  const scored = await scoreEntries(contestId, fresh);
  return rankStandings(scored.map((s) => ({ row: s, standing: s.standing }))).map(toPublic);
}

export type EnterResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "CLOSED" | "NO_LICENCE" | "BAD_ACCOUNT" | "REAL_ACCOUNT" | "BAD_ALIAS" | "ALIAS_TAKEN" | "ALREADY"; message: string };

export async function enterContest(userId: string, slug: string, accountId: string, aliasRaw: unknown, now: Date = new Date()): Promise<EnterResult> {
  const contest = await prisma.contest.findUnique({ where: { slug } });
  if (!contest) return { ok: false, code: "NOT_FOUND", message: "Contest not found." };
  if (contest.status !== "OPEN" || now.getTime() >= contest.endsAt.getTime()) return { ok: false, code: "CLOSED", message: "This contest is not open for entries." };
  const alias = cleanAlias(aliasRaw);
  if (!alias) return { ok: false, code: "BAD_ALIAS", message: "Choose a public name of 3-24 characters (letters, numbers, space, . _ -)." };
  // The entrant must really hold the product: a free demo, a prize licence or a purchase.
  const licence = await prisma.license.findFirst({ where: { buyerId: userId, tradingSystemId: contest.tradingSystemId, licenseStatus: { in: ["ISSUED", "ACTIVE", "EXPIRED"] } } });
  if (!licence) return { ok: false, code: "NO_LICENCE", message: `Start the free ${TRIAL_PRODUCTS[contest.tradingSystemId]?.title ?? "product"} demo first - the contest is for people running it.` };
  const account = await prisma.liveSyncAccount.findFirst({ where: { id: accountId, userId }, select: { id: true, mode: true } });
  if (!account) return { ok: false, code: "BAD_ACCOUNT", message: "That Live Sync account was not found. Connect your demo account in Dashboard > Live Sync first." };
  if (account.mode === "real") return { ok: false, code: "REAL_ACCOUNT", message: "The contest is for demo accounts only." };
  const mine = await prisma.contestEntry.findUnique({ where: { contestId_userId: { contestId: contest.id, userId } } });
  if (mine) return { ok: false, code: "ALREADY", message: "You have already entered this contest." };
  const taken = await prisma.contestEntry.findFirst({ where: { contestId: contest.id, alias: { equals: alias, mode: "insensitive" } } });
  if (taken) return { ok: false, code: "ALIAS_TAKEN", message: "That public name is taken - pick another." };
  try {
    await prisma.contestEntry.create({ data: { contestId: contest.id, userId, accountId, alias } });
  } catch {
    return { ok: false, code: "ALREADY", message: "This account or user is already entered." }; // unique (contest, account) / (contest, user)
  }
  cache.delete(contest.id);
  return { ok: true };
}

export async function myEntry(userId: string, contestId: string) {
  return prisma.contestEntry.findUnique({ where: { contestId_userId: { contestId, userId } } });
}

export interface FinalizeResult {
  contestId: string;
  winners: { rank: number; alias: string; userId: string; profitPct: number; licenseId: string | null; prizeLicenseError?: string }[];
  alreadyFinalized: boolean;
}

/** Freezes the standings, picks the top 3 eligible (one prize per person across contests) and issues the prize licences. Idempotent. */
export async function finalizeContest(slug: string, now: Date = new Date()): Promise<FinalizeResult | { error: string }> {
  const contest = await prisma.contest.findUnique({ where: { slug } });
  if (!contest) return { error: "Contest not found" };
  if (contest.status === "FINALIZED" && contest.winners) return { contestId: contest.id, winners: contest.winners as unknown as FinalizeResult["winners"], alreadyFinalized: true };
  if (now.getTime() < contest.endsAt.getTime()) return { error: "The contest window has not ended yet." };

  const scored = await scoreEntries(contest.id, true);
  const ranked = rankStandings(scored.map((s) => ({ row: s, standing: s.standing })));

  // One prize per person: skip anyone who already won a previous contest.
  const previous = await prisma.contest.findMany({ where: { id: { not: contest.id }, status: "FINALIZED" }, select: { winners: true } });
  const priorWinners = new Set<string>();
  for (const c of previous) for (const w of (Array.isArray(c.winners) ? c.winners : []) as { userId?: string }[]) if (w.userId) priorWinners.add(w.userId);
  const podium = ranked.filter((r) => r.rank !== null && !priorWinners.has(r.row.userId)).slice(0, 3);

  const product = TRIAL_PRODUCTS[contest.tradingSystemId];
  const listing = product ? await prisma.marketplaceListing.findFirst({ where: { slug: product.listingSlug, deletedAt: null }, select: { id: true, versionId: true } }) : null;
  const release = listing?.versionId
    ? await prisma.releaseArtifact.findFirst({ where: { tradingSystemId: contest.tradingSystemId, versionId: listing.versionId, platform: "MT5", releaseStatus: "PUBLISHED", deletedAt: null }, orderBy: { createdAt: "desc" } })
    : null;
  const expiresAt = new Date(now.getTime() + contest.prizeMonths * 30 * 24 * 3600 * 1000);

  const winners: FinalizeResult["winners"] = [];
  for (let i = 0; i < podium.length; i++) {
    const p = podium[i];
    let licenseId: string | null = null;
    let prizeLicenseError: string | undefined;
    if (listing && release) {
      try {
        const res = await issueLicenseForPurchase({
          buyerId: p.row.userId,
          marketplaceListingId: listing.id,
          tradingSystemId: contest.tradingSystemId,
          versionId: release.versionId,
          releaseId: release.id,
          platform: "MT5",
          amount: 0,
          currency: "USD",
          expiresAt,
          provider: "CONTEST_PRIZE",
          providerRef: `PRIZE-${contest.id}-${p.row.userId}`,
        });
        licenseId = res.license.id;
      } catch (e) {
        prizeLicenseError = e instanceof Error ? e.message : "licence could not be issued";
      }
    } else {
      prizeLicenseError = "paid release not found";
    }
    winners.push({ rank: i + 1, alias: p.row.alias, userId: p.row.userId, profitPct: p.standing.profitPct, licenseId, ...(prizeLicenseError ? { prizeLicenseError } : {}) });
  }

  await prisma.contest.update({
    where: { id: contest.id },
    data: { status: "FINALIZED", finalizedAt: now, winners: winners as unknown as object },
  });
  cache.delete(contest.id);
  return { contestId: contest.id, winners, alreadyFinalized: false };
}


export type OfferResult = { ok: true; url: string; percent: number; expiresAt: string } | { ok: false; code: "NOT_FOUND" | "NOT_ENTERED" | "UNAVAILABLE"; message: string };

/**
 * Everyone who entered gets the contest's % off the full product, as a personal single-use payment link (valid until the contest ended plus
 * offerValidDays, and at least 7 more days from today). Created on first claim; later claims return the same link while it is still usable.
 */
export async function claimOffer(userId: string, slug: string, now: Date = new Date()): Promise<OfferResult> {
  const contest = await prisma.contest.findUnique({ where: { slug } });
  if (!contest) return { ok: false, code: "NOT_FOUND", message: "Contest not found." };
  const entry = await prisma.contestEntry.findUnique({ where: { contestId_userId: { contestId: contest.id, userId } } });
  if (!entry) return { ok: false, code: "NOT_ENTERED", message: "The offer is for people who entered the contest." };
  const site = getSiteUrl().replace(/\/$/, "");
  const expiresAt = new Date(Math.max(contest.endsAt.getTime() + contest.offerValidDays * 24 * 3600 * 1000, now.getTime() + 7 * 24 * 3600 * 1000));

  if (entry.offerToken) {
    const link = await prisma.paymentLink.findUnique({ where: { token: entry.offerToken } });
    const usable = link && link.status === "ACTIVE" && (!link.expiresAt || link.expiresAt > now) && (link.maxUses === null || link.usageCount < link.maxUses);
    if (usable) return { ok: true, url: `${site}/pay/${link.token}`, percent: link.discountPercent ?? contest.offerPercent, expiresAt: (link.expiresAt ?? expiresAt).toISOString() };
    if (link && link.usageCount > 0) return { ok: false, code: "UNAVAILABLE", message: "Your offer link was already used." };
  }
  const product = TRIAL_PRODUCTS[contest.tradingSystemId];
  const listing = product ? await prisma.marketplaceListing.findFirst({ where: { slug: product.listingSlug, deletedAt: null }, select: { id: true } }) : null;
  if (!listing) return { ok: false, code: "UNAVAILABLE", message: "The offer is not available right now." };
  const created = await createPaymentLink({ listingId: listing.id, createdByUserId: userId, expiresAt, maxUses: 1, discountPercent: contest.offerPercent });
  if ("code" in created) return { ok: false, code: "UNAVAILABLE", message: created.message };
  await prisma.contestEntry.update({ where: { id: entry.id }, data: { offerToken: created.token } });
  return { ok: true, url: `${site}/pay/${created.token}`, percent: contest.offerPercent, expiresAt: expiresAt.toISOString() };
}
