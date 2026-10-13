// lib/rewards/config.ts
// (Pure - no I/O. Safe for scripts/validate-rewards.ts and the browser.)
// AT24 Rewards & Partner Program, Phase 1 foundation (docs/REWARDS-PARTNER-PROGRAM-SPEC.md).
// All money is INTEGER CENTS. A rebate is a fixed price adjustment written into the contract - never a return, never tied
// to revenue or trading results. Everything is OFF unless REWARDS_PROGRAM_MODE says otherwise.
import { parseAllowlist, parseMode, type SelfServeMode } from "@/lib/marketplace/selfServe";

export type RewardProductKey = "BTC_AI_ALGO" | "GOLD_AI_ALGO" | "INDEX_AI_ALGO" | "TEST_AI_ALGO";

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
  /** Monthly-accrual plan: the rebate is monthlyRebateCents x termMonths, accrued monthly and credited every payoutEveryMonths (last payout carries the remaining months). When set, rebateCents must equal that product and intervalDays is only a rough spacing (about 3 months). */
  monthlyRebateCents?: number;
  payoutEveryMonths?: number;
  /** Owner decision 2026-10-13: the rebate for the three real products is above the list price. Lifts the "rebate below price" guard for this product only. */
  rebateAbovePrice?: boolean;
  /** Referral commission per level in fixed cents: [direct, L1, L2, L3] (2% / 1% / 1% / 1% of the list price, rounded to whole dollars). */
  referralCents: [number, number, number, number];
  /** Owner-only product for testing the whole flow with a tiny amount. Never shown to, or buyable by, anyone else. */
  testOnly?: boolean;
}

export const REWARD_PRODUCTS: Record<RewardProductKey, RewardProductConfig> = {
  BTC_AI_ALGO: { key: "BTC_AI_ALGO", name: "BTC AI Algo", listPriceCents: 499_900, rebateCents: 700_000, installments: 12, intervalDays: 90, termMonths: 35, monthlyRebateCents: 20_000, payoutEveryMonths: 3, rebateAbovePrice: true, referralCents: [10_000, 5_000, 5_000, 5_000] },
  GOLD_AI_ALGO: { key: "GOLD_AI_ALGO", name: "Gold AI Algo", listPriceCents: 999_900, rebateCents: 1_500_000, installments: 10, intervalDays: 90, termMonths: 30, monthlyRebateCents: 50_000, payoutEveryMonths: 3, rebateAbovePrice: true, referralCents: [20_000, 10_000, 10_000, 10_000] },
  INDEX_AI_ALGO: { key: "INDEX_AI_ALGO", name: "Index AI Algo", listPriceCents: 2_999_900, rebateCents: 4_500_000, installments: 9, intervalDays: 90, termMonths: 25, monthlyRebateCents: 180_000, payoutEveryMonths: 3, rebateAbovePrice: true, referralCents: [60_000, 30_000, 30_000, 30_000] },
  // Owner-only test contract: $15 (NOWPayments refuses less than about $10 on USDT-TRC20), rebate 4 x $1.50 due one day apart (so a test finishes in 4 days), commission 2% / 1% / 1% / 1% of $15.
  TEST_AI_ALGO: { key: "TEST_AI_ALGO", name: "Test Contract (owner only)", listPriceCents: 1_500, rebateCents: 600, installments: 4, intervalDays: 1, termMonths: 12, referralCents: [30, 15, 15, 15], testOnly: true },
};

/** The three real products (what every member sees). */
export const REWARD_PRODUCT_KEYS: RewardProductKey[] = ["BTC_AI_ALGO", "GOLD_AI_ALGO", "INDEX_AI_ALGO"];
export const REWARD_TEST_KEY: RewardProductKey = "TEST_AI_ALGO";
/** Real products plus the owner-only test product (admin screens, contracts that already exist). */
export const ALL_REWARD_PRODUCT_KEYS: RewardProductKey[] = [...REWARD_PRODUCT_KEYS, REWARD_TEST_KEY];

export function isRewardProductKey(v: unknown): v is RewardProductKey {
  return typeof v === "string" && (ALL_REWARD_PRODUCT_KEYS as string[]).includes(v);
}

/** Defaults. The live values come from holdDays() / minPayoutCents(), which an owner can lower for testing. */
export const HOLD_DAYS = 7;
export const MIN_PAYOUT_CENTS = 5_000;

/** Days after an amount is released before it can be withdrawn. REWARDS_HOLD_DAYS (0-30) overrides the default 7 - for testing. */
export function holdDays(raw: string | undefined | null = process.env.REWARDS_HOLD_DAYS): number {
  const v = raw === undefined || raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= 30 ? v : HOLD_DAYS;
}

/** Minimum withdrawal in cents. REWARDS_MIN_PAYOUT_USD (1-50, whole dollars) can only LOWER the default 50 - for testing. */
export function minPayoutCents(raw: string | undefined | null = process.env.REWARDS_MIN_PAYOUT_USD): number {
  const v = raw === undefined || raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(v) && v >= 1 && v <= 50 ? v * 100 : MIN_PAYOUT_CENTS;
}
/**
 * Days a referral commission waits after the buyer's payment is confirmed before it can be withdrawn. Default 0: the commission is credited
 * the moment the payment is confirmed. REWARDS_COMMISSION_HOLD_DAYS (0-30, whole days) can add a wait. (Contract rebates keep holdDays().)
 */
export function commissionHoldDays(raw: string | undefined | null = process.env.REWARDS_COMMISSION_HOLD_DAYS): number {
  const v = raw === undefined || raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= 30 ? v : 0;
}
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

/**
 * TEST SWITCH (owner only, temporary): with REWARDS_OWNER_AS_PRO=true the platform OWNER accounts are treated as having an active paid Pro
 * plan for the rewards rules (buy, commission, instalments, withdrawal), so the whole flow can be tested with one's own accounts.
 * Identity (KYC) is still required. Other accounts are never affected. Turn it OFF after the test (default off).
 */
export function ownerAsProEnabled(raw: string | undefined | null = process.env.REWARDS_OWNER_AS_PRO): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/**
 * Universal referral (docs/UNIVERSAL-REFERRAL-SPEC.md): the same 2% / 1% / 1% / 1% plan on every other payment (products and Pro subscription
 * payments, including every renewal). OFF unless REFERRAL_ALL_PRODUCTS is exactly "true". Levels 2-4 still need REWARDS_MULTI_LEVEL.
 */
export const REFERRAL_PERCENT_BPS: [number, number, number, number] = [200, 100, 100, 100];
export function referralAllProductsEnabled(raw: string | undefined | null = process.env.REFERRAL_ALL_PRODUCTS): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/** Withdrawals can be switched off independently of the rest of the program. */
export function withdrawalsEnabled(raw: string | undefined | null = process.env.REWARDS_WITHDRAWALS): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/** Words that must never appear in program copy (checked by validate-rewards on the user-facing strings). */
export const BANNED_COPY_WORDS = ["stake", "staking", "invest", "investment", "apy", "roi", "passive income", "profit share", "guaranteed", "guarantee", "earn while you sleep"];
