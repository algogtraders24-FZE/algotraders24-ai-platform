// app/dashboard/algo-contracts/page.tsx
// AT24 Diamond Members program ("Algo Contracts") - the member's own page (docs/REWARDS-PARTNER-PROGRAM-SPEC.md).
// Server-gated: only accounts the rollout mode has opened see it. This file only loads data and builds the view-model
// (lib/rewards/viewModel.ts); the drawing is in components/rewards/AlgoContractsView.tsx. A rebate is a fixed price adjustment
// written into the contract; nothing here is a forecast.
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import AlgoContractsView from "@/components/rewards/AlgoContractsView";
import { requireUser } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { loadUserFacts, rewardsOpenFor } from "@/lib/rewards/access";
import { badgeFor } from "@/lib/rewards/badge";
import { REWARD_PRODUCTS, REWARD_PRODUCT_KEYS, REWARD_TEST_KEY, holdDays, isRewardProductKey, minPayoutCents, multiLevelReferralEnabled, referralAllProductsEnabled, withdrawalsEnabled } from "@/lib/rewards/config";
import { isPlatformOwner } from "@/lib/marketplace/selfServe";
import { canEarnReferral, isIdentityVerified, isProActive } from "@/lib/rewards/eligibility";
import { referralLink } from "@/lib/rewards/referral";
import { buildProductVM, type AlgoContractsVM } from "@/lib/rewards/viewModel";
import { getBalances, listPayouts } from "@/services/rewards/payoutStore";
import { getReferralCode } from "@/services/rewards/referralStore";
import { getAddressView } from "@/services/rewards/addressStore";
import { slotSummary } from "@/services/rewards/slotStore";
import { identityProvider } from "@/services/marketplace/identityStore";

export const dynamic = "force-dynamic";

const EMPTY_BALANCES = { scheduled: 0, frozen: 0, holding: 0, available: 0, requested: 0, paid: 0, reversed: 0 };

export default async function AlgoContractsPage() {
  const sessionUser = await requireUser();
  const user = sessionUser.profile;

  if (!rewardsOpenFor(user.email)) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Pro members" title="Algo Contracts" description="12-month AI Algo contracts for Pro members." />
        <EmptyState title="Not open for your account yet" description="We will let you know when Algo Contracts opens." />
      </div>
    );
  }

  const facts = await loadUserFacts(user.id, user.email);
  const now = new Date();
  const proOk = isProActive(facts.subscription, now);
  const kycOk = isIdentityVerified(facts.identity);

  // The reward tables only exist once the migration is applied; until then every read below falls back to "nothing yet".
  const [slots, productRows, contracts, refCode, balances, payouts, addressView] = await Promise.all([
    slotSummary().catch(() => ({ month: "", byProduct: {} as Record<string, { limit: number; opened: boolean; remaining: number }> })),
    prisma.rewardProduct.findMany({ select: { key: true, enabled: true } }).catch(() => []),
    prisma.rewardContract.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }).catch(() => []),
    getReferralCode(user.id),
    getBalances(user.id).catch(() => EMPTY_BALANCES),
    listPayouts(user.id).catch(() => []),
    getAddressView(user.id).catch(() => null),
  ]);
  const enabled = new Set(productRows.filter((r) => r.enabled).map((r) => r.key));
  const installments = contracts.length
    ? await prisma.rebateInstallment.findMany({ where: { contractId: { in: contracts.map((c) => c.id) } }, orderBy: [{ contractId: "asc" }, { seq: "asc" }] }).catch(() => [])
    : [];
  const myBadge = badgeFor(contracts.filter((c) => isRewardProductKey(c.productKey)).map((c) => ({ productKey: c.productKey as never, status: c.status as never })));

  const vm: AlgoContractsVM = {
    nowIso: now.toISOString(),
    eligibility: { proOk, kycOk, kycAvailable: identityProvider() !== null },
    products: (isPlatformOwner(user.email) ? [...REWARD_PRODUCT_KEYS, REWARD_TEST_KEY] : REWARD_PRODUCT_KEYS).map((key) => {
      const slot = slots.byProduct[key] ?? null;
      const blockedReason = !enabled.has(key) ? "Opens soon" : !proOk ? "Active paid Pro plan needed" : !kycOk ? "Identity verification needed" : !slot?.opened ? "Closed this month" : slot.remaining <= 0 ? "All slots taken this month" : null;
      return buildProductVM(key, { slot, blockedReason });
    }),
    contracts: contracts
      .filter((c) => isRewardProductKey(c.productKey))
      .map((c) => ({
        id: c.id,
        productKey: c.productKey as never,
        productName: REWARD_PRODUCTS[c.productKey as keyof typeof REWARD_PRODUCTS].name,
        status: c.status,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt.toISOString(),
        listPriceCents: c.listPriceCents,
        netPriceCents: c.netPriceCents,
        rebateTotalCents: c.rebateTotalCents,
        documentReady: c.status !== "PENDING_DOCUMENT",
        installments: installments.filter((i) => i.contractId === c.id).map((i) => ({ seq: i.seq, dueAt: i.dueAt.toISOString(), amountCents: i.amountCents, status: i.status })),
      })),
    badge: myBadge ? { tier: myBadge.tier, dimmed: myBadge.dimmed } : null,
    balances,
    payouts: payouts.map((p) => ({ id: p.id, amountCents: p.amountCents, network: p.network, status: p.status, txRef: p.txRef, createdAt: p.createdAt.toISOString() })),
    withdrawals: {
      open: withdrawalsEnabled(),
      blockedReason: !proOk ? "An active paid Pro plan is needed to withdraw." : !kycOk ? "Identity verification is needed to withdraw." : null,
      minCents: minPayoutCents(),
      holdDays: holdDays(),
      address: addressView,
    },
    referral: {
      link: refCode ? referralLink(refCode, process.env.NEXT_PUBLIC_SITE_URL || undefined) : null,
      blockedReason: canEarnReferral(facts, now) || isPlatformOwner(user.email) ? null : "An active paid Pro plan and a verified identity are needed to get a referral link.",
      multiLevel: multiLevelReferralEnabled(),
      allProducts: referralAllProductsEnabled(),
    },
  };

  return <AlgoContractsView vm={vm} />;
}
