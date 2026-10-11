// lib/rewards/config.ts
// (Pure - no I/O. Safe for scripts/validate-rewards.ts and the browser.)
// AT24 Rewards & Partner Program, Phase 1 foundation (docs/REWARDS-PARTNER-PROGRAM-SPEC.md).
// All money is INTEGER CENTS. A rebate is a fixed price adjustment written into the contract - never a return, never tied
// to revenue or trading results. Everything is OFF unless REWARDS_PROGRAM_MODE says otherwise.
import { parseAllowlist, parseMode, type SelfServeMode } from "@/lib/marketplace/selfServe";

export type RewardProductKey = "BTC_AI_ALGO" | "GOLD_AI_ALGO" | "INDEX_AI_ALGO";

export interface RewardProductConfig {
  key: RewardProductKey;
  name: string;
  listPriceCents: number;
  /** Whole rebate in cents, fixed in the contract (a round dollar figure, e.g. $2,000 on $4,999 - roughly 40%). */
  rebateCents: number;
  /** Number of equal rebate instalments. */
  installments: number;
  /** Days between instalments (first one is due after one interval). */
  intervalDays: number;
  termMonths: number;
  /** Referral commission per level in fixed cents: [direct, L1, L2, L3] (2% / 1% / 1% / 1% of the list price, rounded to whole dollars). */
  referralCents: [number, number, number, number];
}

export const REWARD_PRODUCTS: Record<RewardProductKey, RewardProductConfig> = {
  BTC_AI_ALGO: { key: "BTC_AI_ALGO", name: "BTC AI Algo", listPriceCents: 499_900, rebateCents: 200_000, installments: 4, intervalDays: 90, termMonths: 12, referralCents: [10_000, 5_000, 5_000, 5_000] },
  GOLD_AI_ALGO: { key: "GOLD_AI_ALGO", name: "Gold AI Algo", listPriceCents: 999_900, rebateCents: 500_000, installments: 4, intervalDays: 90, termMonths: 12, referralCents: [20_000, 10_000, 10_000, 10_000] },
  INDEX_AI_ALGO: { key: "INDEX_AI_ALGO", name: "Index AI Algo", listPriceCents: 2_999_900, rebateCents: 1_800_000, installments: 4, intervalDays: 90, termMonths: 12, referralCents: [60_000, 30_000, 30_000, 30_000] },
};

export const REWARD_PRODUCT_KEYS = Object.keys(REWARD_PRODUCTS) as RewardProductKey[];

export function isRewardProductKey(v: unknown): v is RewardProductKey {
  return typeof v === "string" && (REWARD_PRODUCT_KEYS as string[]).includes(v);
}

/** Days after an amount is released before it can be withdrawn. */
export const HOLD_DAYS = 7;
export const MIN_PAYOUT_CENTS = 5_000;
/** How long a checkout keeps a slot reserved. */
export const SLOT_HOLD_MINUTES = 30;
export const DEFAULT_SLOTS_PER_MONTH = 10;
export const REFERRAL_WINDOW_DAYS = 30;
/** Version of the contract wording stamped on every issued contract (bumped when the template changes). */
export const CONTRACT_TERMS_VERSION = "2026-10-draft-1";

/** Rollout: off (default) | allowlist | public. The platform owner accounts are always allowed. */
export function rewardsMode(raw: string | undefined | null = process.env.REWARDS_PROGRAM_MODE): SelfServeMode {
  return parseMode(raw);
}

export function rewardsAllowlist(raw: string | undefined | null = process.env.REWARDS_PROGRAM_ALLOWLIST): string[] {
  return parseAllowlist(raw);
}

/** Referral levels 2-4 stay disabled until written counsel approval. Only the exact string "true" enables them. */
export function multiLevelReferralEnabled(raw: string | undefined | null = process.env.REWARDS_MULTI_LEVEL): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/** Withdrawals can be switched off independently of the rest of the program. */
export function withdrawalsEnabled(raw: string | undefined | null = process.env.REWARDS_WITHDRAWALS): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/** Words that must never appear in program copy (checked by validate-rewards on the user-facing strings). */
export const BANNED_COPY_WORDS = ["stake", "staking", "invest", "investment", "apy", "roi", "passive income", "profit share", "guaranteed", "guarantee", "earn while you sleep"];
