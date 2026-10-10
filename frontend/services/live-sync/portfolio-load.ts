// services/live-sync/portfolio-load.ts
// DB side of "My portfolio": loads ONE user's synced accounts (never anyone else's), their deals and a friendly label,
// then runs the pure builder. Every query is scoped to the user id.

import { prisma } from "@/lib/prisma";
import { fetchDeals } from "@/services/live-results/prisma-store";
import { buildPortfolio, type Portfolio, type PortfolioAccountInput } from "./portfolio";

const MAX_ACCOUNTS = 20;

export async function loadPortfolio(userId: string, nowUtc: number = Date.now()): Promise<Portfolio> {
  const accounts = await prisma.liveSyncAccount.findMany({ where: { userId }, orderBy: { lastSyncAt: "desc" }, take: MAX_ACCOUNTS });
  if (accounts.length === 0) return { generatedAt: nowUtc, rows: [], groups: [] };
  const pages = await prisma.liveResultsPage.findMany({ where: { userId, accountId: { in: accounts.map((a) => a.id) } }, orderBy: { createdAt: "asc" }, select: { accountId: true, title: true } });
  const titleOf = new Map<string, string>();
  for (const p of pages) if (!titleOf.has(p.accountId)) titleOf.set(p.accountId, p.title);

  const inputs: PortfolioAccountInput[] = [];
  for (const a of accounts) {
    const deals = await fetchDeals(a.id);
    const short = `Account ${a.accountKey.slice(0, 6)}`;
    inputs.push({
      id: a.id,
      label: titleOf.has(a.id) ? `${titleOf.get(a.id)} (${short.slice(8)})` : short,
      mode: a.mode,
      platform: a.platform === "mt4" ? "MT4" : "MT5",
      broker: a.broker,
      currency: a.currency,
      marginMode: a.marginMode,
      serverUtcOffsetSec: a.serverUtcOffsetSec,
      firstSyncAt: a.firstSyncAt.getTime(),
      lastSyncAt: a.lastSyncAt.getTime(),
      lastBalance: a.lastBalance,
      lastEquity: a.lastEquity,
      deals,
    });
  }
  return buildPortfolio(inputs, nowUtc);
}
