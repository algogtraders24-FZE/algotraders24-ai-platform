// services/news/quota.service.ts
// AN1.2/AN1.6 - authoritative, race-safe daily provider-call budget. A
// plain "SELECT count, then INSERT if under limit" is a real TOCTOU race
// under concurrent callers (two invocations can both observe "24 used" and
// both proceed to call #25/#26) - this uses a single atomic conditional
// upsert instead, which Prisma's typed `upsert()` cannot express (no WHERE
// on the update branch), hence the one deliberate use of $executeRaw in
// this feature.
import "server-only";
import { prisma } from "@/lib/prisma";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Atomically reserves one call against `provider`'s daily budget. Returns
 * true only if the reservation succeeded (budget was not yet exhausted) -
 * the caller must not make the real provider call unless this returns true.
 * `dailyLimit` is read fresh from config by the caller (see env.ts) and
 * only takes effect for a NEW (provider, date) row - an in-progress day's
 * row keeps whatever limit it was created with.
 */
export async function tryReserveProviderCall(provider: string, dailyLimit: number): Promise<boolean> {
  const date = todayUtc();
  const affected = await prisma.$executeRaw`
    INSERT INTO provider_quotas (provider, date, "usedCount", "dailyLimit", "updatedAt")
    VALUES (${provider}, ${date}, 1, ${dailyLimit}, now())
    ON CONFLICT (provider, date)
    DO UPDATE SET "usedCount" = provider_quotas."usedCount" + 1, "updatedAt" = now()
    WHERE provider_quotas."usedCount" < provider_quotas."dailyLimit"
  `;
  return affected > 0;
}

/** Best-effort audit trail entry - never throws, since a logging failure must not fail the ingestion it's describing. */
export async function logProviderCall(
  provider: string,
  purpose: "scheduled-ingestion" | "on-demand-fallback",
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  try {
    await prisma.providerCallLog.create({
      data: { provider, purpose, success, errorMessage: errorMessage ?? null },
    });
  } catch {
    // best-effort only - see header comment
  }
}

/**
 * The most recent successful real call across providers (or one specific
 * provider). This is the correct source for API-facing "freshness", NOT
 * MAX(NewsArticle.fetchedAt) - a successful ingestion that found zero new
 * articles (everything deduped against existing rows) wouldn't move any
 * row's fetchedAt forward, which would incorrectly make a genuinely fresh
 * check look stale.
 */
export async function getLatestSuccessfulCallAt(provider?: string): Promise<Date | null> {
  const row = await prisma.providerCallLog.findFirst({
    where: { success: true, ...(provider ? { provider } : {}) },
    orderBy: { calledAt: "desc" },
    select: { calledAt: true },
  });
  return row?.calledAt ?? null;
}
