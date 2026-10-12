// lib/rewards/access.ts
// (Server only - reads the database.) The signed-in user's facts for the rewards rules, plus the rollout check.
// Reads ONLY tables that already exist in production (Subscription, SellerIdentity). The reward tables are not queried until
// the Phase 1 migration has been applied and the purchase flow is switched on.
import { prisma } from "@/lib/prisma";
import type { IdentityStatus } from "@/lib/marketplace/identity";
import { programOpenFor, type UserFacts } from "./eligibility";
import { ownerAsProEnabled, rewardsAllowlist, rewardsMode } from "./config";
import { isPlatformOwner } from "@/lib/marketplace/selfServe";

export function rewardsOpenFor(email: string | null | undefined): boolean {
  return programOpenFor(rewardsMode(), email, rewardsAllowlist());
}

const IDENTITY_STATUSES: IdentityStatus[] = ["PENDING", "VERIFIED", "REJECTED", "RETRY"];

export async function loadUserFacts(userId: string, email: string | null | undefined): Promise<UserFacts> {
  const [sub, ident] = await Promise.all([
    prisma.subscription.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.sellerIdentity.findUnique({ where: { userId }, select: { status: true } }).catch(() => null),
  ]);
  const identity = (IDENTITY_STATUSES as string[]).includes(ident?.status ?? "") ? (ident!.status as IdentityStatus) : "NONE";
  // Owner test switch: an owner account counts as paid Pro (never anyone else, and KYC is still required).
  if (ownerAsProEnabled() && isPlatformOwner(email)) {
    return { email, subscription: { planId: "pro", status: "active", currentPeriodEnd: new Date(Date.now() + 3650 * 86_400_000), provider: "owner-test" }, identity };
  }
  return {
    email,
    subscription: sub ? { planId: sub.planId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, provider: sub.provider } : null,
    identity,
  };
}
