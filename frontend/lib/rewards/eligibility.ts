// lib/rewards/eligibility.ts
// (Pure - no I/O.) Who may buy a program contract, receive a rebate instalment, or withdraw.
// "Pro" mirrors lib/access/quant-pro.ts (a non-free plan whose Subscription is active and not past its period end) with one
// stricter rule for this paid program: it must be backed by a real payment provider, so admin-granted Pro never qualifies.
import { isPlatformOwner } from "@/lib/marketplace/selfServe";
import type { IdentityStatus } from "@/lib/marketplace/identity";
import type { SelfServeMode } from "@/lib/marketplace/selfServe";

export interface SubscriptionFacts {
  planId: string;
  status: string;
  currentPeriodEnd: Date;
  /** Subscription.provider - set only by a verified payment webhook. Null = free or admin-granted, which does NOT qualify. */
  provider: string | null;
}

export interface UserFacts {
  email: string | null | undefined;
  subscription: SubscriptionFacts | null;
  /** SellerIdentity.status, or "NONE" when the user has no row. */
  identity: IdentityStatus;
}

export type Verdict = { ok: true } | { ok: false; reasons: string[] };

const ok = (): Verdict => ({ ok: true });
const no = (...reasons: string[]): Verdict => ({ ok: false, reasons });

export function isProActive(sub: SubscriptionFacts | null, now: Date = new Date()): boolean {
  if (!sub) return false;
  if (sub.planId === "free") return false;
  if (!sub.provider) return false;
  if (sub.status !== "active") return false;
  return sub.currentPeriodEnd.getTime() > now.getTime();
}

export function isIdentityVerified(identity: IdentityStatus): boolean {
  return identity === "VERIFIED";
}

/** Is the program visible/usable for this user at all, given the rollout mode? Owners are always in. */
export function programOpenFor(mode: SelfServeMode, email: string | null | undefined, allowlist: string[]): boolean {
  if (isPlatformOwner(email)) return true;
  if (mode === "public") return true;
  if (mode === "allowlist") return !!email && allowlist.includes(email.trim().toLowerCase());
  return false;
}

export interface BuyContext {
  mode: SelfServeMode;
  allowlist: string[];
  productEnabled: boolean;
  /** Slots left in the month for this product (after live holds). */
  slotsRemaining: number;
  now?: Date;
}

/** May this user start a purchase? Re-run at payment verification too. Collects every reason so the UI can show a checklist. */
export function canBuyContract(user: UserFacts, ctx: BuyContext): Verdict {
  const now = ctx.now ?? new Date();
  if (!programOpenFor(ctx.mode, user.email, ctx.allowlist)) return no("The rewards program is not open to your account yet.");
  const reasons: string[] = [];
  if (!ctx.productEnabled) reasons.push("This product is not open for new contracts.");
  if (!isProActive(user.subscription, now)) reasons.push("An active Pro plan is required.");
  if (!isIdentityVerified(user.identity)) reasons.push("Identity verification (KYC) must be completed first.");
  if (ctx.slotsRemaining <= 0) reasons.push("No slots are left this month.");
  return reasons.length ? { ok: false, reasons } : ok();
}

export type ContractStatus = "PENDING_DOCUMENT" | "ACTIVE" | "FROZEN" | "ENDED" | "REVOKED";

export interface ContractFacts {
  status: ContractStatus;
  endsAt: Date;
}

export type ReleaseDecision =
  | { action: "RELEASE" }
  | { action: "FREEZE"; reason: string }
  | { action: "CANCEL"; reason: string };

/**
 * What to do with an instalment that is due. Never forfeits for a lapse: a Pro/KYC problem FREEZES (kept, released later
 * when the user is eligible again). Only a revoked contract cancels. An ended contract with a frozen instalment still
 * freezes - what happens to leftovers at term end is a counsel/owner decision (spec section 18) and is not silently deleted.
 */
export function decideInstalment(contract: ContractFacts, user: UserFacts, now: Date = new Date()): ReleaseDecision {
  if (contract.status === "REVOKED") return { action: "CANCEL", reason: "Contract revoked" };
  if (contract.status === "PENDING_DOCUMENT") return { action: "FREEZE", reason: "Contract document not issued yet" };
  if (!isProActive(user.subscription, now)) return { action: "FREEZE", reason: "Pro plan not active" };
  if (!isIdentityVerified(user.identity)) return { action: "FREEZE", reason: "Identity not verified" };
  return { action: "RELEASE" };
}

/** May this user withdraw `amountCents` of AVAILABLE balance? Checked at request and again at admin approval. */
export function canWithdraw(
  user: UserFacts,
  opts: { availableCents: number; amountCents: number; minCents: number; withdrawalsOn: boolean; now?: Date },
): Verdict {
  const now = opts.now ?? new Date();
  const reasons: string[] = [];
  if (!opts.withdrawalsOn) reasons.push("Withdrawals are not open yet.");
  if (!isProActive(user.subscription, now)) reasons.push("An active Pro plan is required to withdraw.");
  if (!isIdentityVerified(user.identity)) reasons.push("Identity verification (KYC) is required to withdraw.");
  if (!Number.isInteger(opts.amountCents) || opts.amountCents <= 0) reasons.push("Enter a valid amount.");
  else if (opts.amountCents < opts.minCents) reasons.push("Below the minimum withdrawal.");
  if (opts.amountCents > opts.availableCents) reasons.push("More than your available balance.");
  return reasons.length ? { ok: false, reasons } : ok();
}

/**
 * A partner earns referral commission only if they have an active paid Pro plan when the sale is verified. Anyone can HAVE a link; a verified
 * identity is not needed to earn, only to withdraw (see canWithdraw).
 */
export function canEarnReferral(user: UserFacts, now: Date = new Date()): boolean {
  return isProActive(user.subscription, now);
}
