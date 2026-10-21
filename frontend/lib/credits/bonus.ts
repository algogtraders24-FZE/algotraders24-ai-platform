// lib/credits/bonus.ts
// (Pure - no I/O. Safe for scripts and the browser.) One-time promotional AI credits earned by completing a verification step.
// A credit is one AI chat message, the same unit as the plan allowance. Bonus credits are NOT cash, cannot be transferred, are spent only
// after the plan's monthly allowance is used up, and expire. Each step pays once per account (a unique row per user and kind).

export type BonusKind = "EMAIL_VERIFIED" | "KYC_VERIFIED" | "TELEGRAM_LINKED" | "REFERRED_SIGNUP";

export interface BonusRule {
  kind: BonusKind;
  amount: number;
  label: string;
  /** Short line for the checklist card. */
  hint: string;
}

/** Amounts are the owner's decision of 2026-10-21. KYC is the largest because it is the hardest to fake and the one that matters for withdrawals and selling. */
export const BONUS_RULES: Record<BonusKind, BonusRule> = {
  EMAIL_VERIFIED: { kind: "EMAIL_VERIFIED", amount: 50, label: "Verify your email", hint: "Confirm the link we emailed you." },
  KYC_VERIFIED: { kind: "KYC_VERIFIED", amount: 200, label: "Verify your identity", hint: "Needed to withdraw earnings and to sell on the marketplace." },
  TELEGRAM_LINKED: { kind: "TELEGRAM_LINKED", amount: 25, label: "Link Telegram", hint: "Get your alerts in Telegram." },
  REFERRED_SIGNUP: { kind: "REFERRED_SIGNUP", amount: 100, label: "Joined through a friend's link", hint: "Added once your email is verified." },
};

/** The steps a user can complete themselves, in the order the checklist shows them. REFERRED_SIGNUP is automatic, so it is not a checklist step. */
export const CHECKLIST_KINDS: BonusKind[] = ["EMAIL_VERIFIED", "KYC_VERIFIED", "TELEGRAM_LINKED"];

export const BONUS_EXPIRY_DAYS = 90;

export function bonusExpiry(from: Date, days: number = BONUS_EXPIRY_DAYS): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function isBonusKind(v: unknown): v is BonusKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(BONUS_RULES, v);
}

export interface GrantRow {
  kind: string;
  amount: number;
  remaining: number;
  expiresAt: Date;
}

/** Credits that can still be spent at `now`: not expired, and only what is left of each grant. */
export function activeRemaining(rows: readonly GrantRow[], now: Date): number {
  return rows.reduce((sum, r) => (r.expiresAt.getTime() > now.getTime() && r.remaining > 0 ? sum + r.remaining : sum), 0);
}

/** The most credits one account can ever earn this way (every rule once). */
export function maxLifetimeBonus(): number {
  return (Object.values(BONUS_RULES) as BonusRule[]).reduce((s, r) => s + r.amount, 0);
}
