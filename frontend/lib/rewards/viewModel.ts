// lib/rewards/viewModel.ts
// (Pure types + builders.) What the Algo Contracts page shows, as plain data. The server page fills it from the database; the view
// component only draws it. Dates are ISO strings so the same object can cross the server/client boundary.
import { REWARD_PRODUCTS, REWARD_PRODUCT_KEYS, type RewardProductKey } from "./config";
import { computeContractMoney } from "./money";

export interface SlotVM { opened: boolean; remaining: number; limit: number }

export interface ProductVM {
  key: RewardProductKey;
  name: string;
  tagline: string;
  termMonths: number;
  listPriceCents: number;
  rebateTotalCents: number;
  perQuarterCents: number;
  installments: number;
  intervalMonths: number;
  netPriceCents: number;
  slot: SlotVM | null;
  /** Why the buy button is not available, or null when the member can buy. */
  blockedReason: string | null;
  referralDirectCents: number;
  referralUpperCents: number[];
}

export interface InstallmentVM { seq: number; dueAt: string; amountCents: number; status: string }

export interface ContractVM {
  id: string;
  productKey: RewardProductKey;
  productName: string;
  status: string;
  startsAt: string;
  endsAt: string;
  listPriceCents: number;
  netPriceCents: number;
  rebateTotalCents: number;
  installments: InstallmentVM[];
  documentReady: boolean;
}

export interface BalancesVM { scheduled: number; frozen: number; holding: number; available: number; requested: number; paid: number }
export interface PayoutVM { id: string; amountCents: number; network: string; status: string; txRef: string | null; createdAt: string }

export interface AlgoContractsVM {
  nowIso: string;
  eligibility: { proOk: boolean; kycOk: boolean };
  products: ProductVM[];
  contracts: ContractVM[];
  badge: { tier: RewardProductKey; dimmed: boolean } | null;
  balances: BalancesVM;
  payouts: PayoutVM[];
  withdrawals: { open: boolean; blockedReason: string | null; minCents: number; holdDays: number };
  referral: { link: string | null; blockedReason: string | null; multiLevel: boolean };
}

const TAGLINES: Record<RewardProductKey, string> = {
  BTC_AI_ALGO: "BTC-USD, trades around the clock",
  GOLD_AI_ALGO: "XAUUSD gold, for 2 and 3 digit brokers",
  INDEX_AI_ALGO: "Index CFDs such as US30",
};

/** The static part of a product card (money maths comes from the same code that issues the contract). */
export function buildProductVM(key: RewardProductKey, opts: { slot: SlotVM | null; blockedReason: string | null }): ProductVM {
  const p = REWARD_PRODUCTS[key];
  const m = computeContractMoney(p, new Date(0));
  return {
    key,
    name: p.name,
    tagline: TAGLINES[key],
    termMonths: p.termMonths,
    listPriceCents: m.listPriceCents,
    rebateTotalCents: m.rebateTotalCents,
    perQuarterCents: m.schedule[0].amountCents,
    installments: p.installments,
    intervalMonths: Math.round(p.intervalDays / 30),
    netPriceCents: m.netPriceCents,
    slot: opts.slot,
    blockedReason: opts.blockedReason,
    referralDirectCents: p.referralCents[0],
    referralUpperCents: p.referralCents.slice(1),
  };
}

export { REWARD_PRODUCT_KEYS };
