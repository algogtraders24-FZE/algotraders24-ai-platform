// services/credits/bonusCredits.ts
// (Server only.) Bonus AI credits: grant on a completed verification step, spend after the plan allowance, summarise for the dashboard.
// Everything is best effort and never throws: a failed grant must never break sign-in, KYC or a chat message. The store is injectable so the
// validator runs without a database.
import { prisma } from "@/lib/prisma";
import { BONUS_RULES, activeRemaining, bonusExpiry, type BonusKind, type GrantRow } from "@/lib/credits/bonus";
import { prismaBonusStore, type BonusStore } from "./bonusStore";

const defaultStore = prismaBonusStore();

/** Users whose sign-up bonuses are already settled in this server process, so a normal request costs no query. */
const settled = new Set<string>();

export async function awardBonus(userId: string, kind: BonusKind, opts: { store?: BonusStore; now?: Date } = {}): Promise<boolean> {
  try {
    const store = opts.store ?? defaultStore;
    const now = opts.now ?? new Date();
    return await store.grant(userId, kind, BONUS_RULES[kind].amount, bonusExpiry(now));
  } catch (e) {
    console.error(`[bonus] grant ${kind} failed (non-fatal):`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Called after the session user is resolved. Once the email is verified: pays the email step, and the "joined through a friend" step when the
 * account was attached to a referral link. Cheap after the first verified request (a per-process memo), and a no-op while the email is unverified.
 */
export async function ensureSignupBonuses(userId: string, emailVerified: boolean, opts: { store?: BonusStore; referred?: () => Promise<boolean> } = {}): Promise<void> {
  if (!emailVerified || settled.has(userId)) return;
  try {
    await awardBonus(userId, "EMAIL_VERIFIED", { store: opts.store });
    const referred =
      opts.referred ??
      (async () => {
        if (process.env.REFERRAL_ALL_PRODUCTS !== "true") return false;
        const a = await prisma.referralAttribution.findFirst({ where: { buyerId: userId }, select: { id: true } });
        return a !== null;
      });
    if (await referred()) await awardBonus(userId, "REFERRED_SIGNUP", { store: opts.store });
    settled.add(userId);
  } catch (e) {
    console.error("[bonus] signup bonuses failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

/** Spends one bonus credit. False when none is left (or on any error), so the caller keeps its normal "limit reached" answer. */
export async function consumeBonusCredit(userId: string, opts: { store?: BonusStore; now?: Date } = {}): Promise<boolean> {
  try {
    return await (opts.store ?? defaultStore).consumeOne(userId, opts.now ?? new Date());
  } catch {
    return false;
  }
}

export interface BonusSummary {
  remaining: number;
  /** Kinds already earned, whether or not they are used up. */
  earned: BonusKind[];
  /** Soonest expiry among grants that still have credits, ISO, or null. */
  nextExpiry: string | null;
}

export async function getBonusSummary(userId: string, opts: { store?: BonusStore; now?: Date } = {}): Promise<BonusSummary> {
  const now = opts.now ?? new Date();
  let rows: GrantRow[] = [];
  try {
    rows = await (opts.store ?? defaultStore).list(userId);
  } catch {
    rows = [];
  }
  const live = rows.filter((r) => r.remaining > 0 && r.expiresAt.getTime() > now.getTime()).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  return {
    remaining: activeRemaining(rows, now),
    earned: rows.map((r) => r.kind as BonusKind),
    nextExpiry: live[0] ? live[0].expiresAt.toISOString() : null,
  };
}
