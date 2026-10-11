// lib/rewards/badge.ts
// (Pure - no I/O.) The diamond badge shown next to a program member's name. It is a STATUS marker for holding an active
// contract - not a rating, an endorsement, or a statement about anyone's results. Colour = the product tier.
import type { RewardProductKey } from "./config";
import type { ContractStatus } from "./eligibility";

export interface BadgeTier {
  key: RewardProductKey;
  rank: number;
  label: string;
  /** Diamond colour (hex). Chosen to stay readable on light and dark backgrounds. */
  color: string;
  description: string;
}

export const BADGE_TIERS: Record<RewardProductKey, BadgeTier> = {
  BTC_AI_ALGO: { key: "BTC_AI_ALGO", rank: 1, label: "Blue Diamond", color: "#2F80ED", description: "Active BTC AI Algo contract" },
  GOLD_AI_ALGO: { key: "GOLD_AI_ALGO", rank: 2, label: "Gold Diamond", color: "#E0A800", description: "Active Gold AI Algo contract" },
  INDEX_AI_ALGO: { key: "INDEX_AI_ALGO", rank: 3, label: "Violet Diamond", color: "#8E44EC", description: "Active Index AI Algo contract" },
};

export interface MemberBadge {
  tier: RewardProductKey;
  label: string;
  color: string;
  /** True while the contract is frozen: shown, but greyed out so it never overstates the status. */
  dimmed: boolean;
}

/** The single badge to show for a user's contracts: the highest ACTIVE tier, else the highest FROZEN one (dimmed), else none. */
export function badgeFor(contracts: Array<{ productKey: RewardProductKey; status: ContractStatus }>): MemberBadge | null {
  const best = (status: ContractStatus) =>
    contracts.filter((c) => c.status === status).sort((a, b) => BADGE_TIERS[b.productKey].rank - BADGE_TIERS[a.productKey].rank)[0];
  const active = best("ACTIVE");
  if (active) return { tier: active.productKey, label: BADGE_TIERS[active.productKey].label, color: BADGE_TIERS[active.productKey].color, dimmed: false };
  const frozen = best("FROZEN");
  if (frozen) return { tier: frozen.productKey, label: BADGE_TIERS[frozen.productKey].label, color: BADGE_TIERS[frozen.productKey].color, dimmed: true };
  return null;
}

/** Plain-text form for emails and notifications ("Ravi 💎"). The coloured version is rendered by the UI from `badge.color`. */
export function displayNameWithBadge(name: string, badge: MemberBadge | null): string {
  return badge ? `${name} \u{1F48E}` : name;
}
