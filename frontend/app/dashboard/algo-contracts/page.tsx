// app/dashboard/algo-contracts/page.tsx
// AT24 Diamond Members program ("Algo Contracts") - the member's own page (docs/REWARDS-PARTNER-PROGRAM-SPEC.md).
// Server-gated: only accounts the rollout mode has opened see it. Phase 1 shows the eligibility checklist, the three 12-month
// contracts with their fixed rebate schedule and net price, and the badge tiers. Purchasing opens in the next phase, so no
// buy button is live and no reward table is read yet. A rebate is a fixed price adjustment written into the contract.
import { CheckCircle2, Circle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import MemberBadge from "@/components/rewards/MemberBadge";
import BuyContract from "@/components/rewards/BuyContract";
import ReferralCard from "@/components/rewards/ReferralCard";
import WithdrawCard from "@/components/rewards/WithdrawCard";
import { getBalances, listPayouts } from "@/services/rewards/payoutStore";
import { prisma } from "@/lib/prisma";
import { getReferralCode } from "@/services/rewards/referralStore";
import { slotSummary } from "@/services/rewards/slotStore";
import { badgeFor } from "@/lib/rewards/badge";
import { canEarnReferral } from "@/lib/rewards/eligibility";
import { referralLink } from "@/lib/rewards/referral";
import { isRewardProductKey, MIN_PAYOUT_CENTS, withdrawalsEnabled } from "@/lib/rewards/config";
import { requireUser } from "@/lib/auth/protectedRoute";
import { loadUserFacts, rewardsOpenFor } from "@/lib/rewards/access";
import { isIdentityVerified, isProActive } from "@/lib/rewards/eligibility";
import { REWARD_PRODUCTS, REWARD_PRODUCT_KEYS, DEFAULT_SLOTS_PER_MONTH, HOLD_DAYS } from "@/lib/rewards/config";
import { computeContractMoney, formatUsd } from "@/lib/rewards/money";

export const dynamic = "force-dynamic";

function Check({ done, label, hint, href, cta }: { done: boolean; label: string; hint: string; href: string; cta: string }) {
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        {done ? <CheckCircle2 size={18} className="mt-0.5 text-success" aria-hidden="true" /> : <Circle size={18} className="mt-0.5 text-text-3" aria-hidden="true" />}
        <div>
          <p className="text-sm font-medium text-text">{label}</p>
          <p className="text-xs text-text-3">{hint}</p>
        </div>
      </div>
      {done ? <Badge tone="success">Done</Badge> : <ButtonLink href={href} variant="secondary" size="sm">{cta}</ButtonLink>}
    </li>
  );
}

export default async function RewardsPage() {
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
  const [slots, productRows, contracts, refCode, balances, payouts] = await Promise.all([
    slotSummary().catch(() => ({ month: "", byProduct: {} as Record<string, { limit: number; opened: boolean; remaining: number }> })),
    prisma.rewardProduct.findMany({ select: { key: true, enabled: true } }).catch(() => []),
    prisma.rewardContract.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }).catch(() => []),
    getReferralCode(user.id),
    getBalances(user.id).catch(() => ({ scheduled: 0, frozen: 0, holding: 0, available: 0, requested: 0, paid: 0, reversed: 0 })),
    listPayouts(user.id).catch(() => []),
  ]);
  const enabled = new Set(productRows.filter((r) => r.enabled).map((r) => r.key));
  const installments = contracts.length
    ? await prisma.rebateInstallment.findMany({ where: { contractId: { in: contracts.map((c) => c.id) } }, orderBy: [{ contractId: "asc" }, { seq: "asc" }] }).catch(() => [])
    : [];
  const myBadge = badgeFor(contracts.filter((c) => isRewardProductKey(c.productKey)).map((c) => ({ productKey: c.productKey as never, status: c.status as never })));
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL || undefined;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pro members"
        title="Algo Contracts"
        description="12-month AI Algo contracts for Pro members. Each contract includes the product, a signed licence, and a fixed quarterly rebate on the price you pay."
        action={<ButtonLink href="/dashboard/algo-contracts/guide" variant="secondary" size="sm">User guide</ButtonLink>}
      />

      <Card className="space-y-1">
        <h2 className="text-lg font-semibold text-text">What you need first</h2>
        <ul className="divide-y divide-border">
          <Check
            done={proOk}
            label="Active Pro plan"
            hint="Pro must be paid and active. A plan granted without a payment does not qualify."
            href="/dashboard/billing"
            cta="Go to billing"
          />
          <Check
            done={kycOk}
            label="Identity verification (KYC)"
            hint="A one-time ID and selfie check by our verification partner. AT24 never stores your document."
            href="/dashboard/settings"
            cta="Verify identity"
          />
        </ul>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Contracts</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {REWARD_PRODUCT_KEYS.map((key) => {
            const p = REWARD_PRODUCTS[key];
            const m = computeContractMoney(p, now);
            const perQuarter = m.schedule[0].amountCents;
            const slot = slots.byProduct[key];
            const blocked = !enabled.has(key) ? "Opens soon" : !proOk ? "Active paid Pro plan needed" : !kycOk ? "Identity verification needed" : !slot?.opened ? "Closed this month" : slot.remaining <= 0 ? "All slots taken this month" : null;
            return (
              <Card key={key} className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-text">{p.name}</h3>
                  <MemberBadge tier={key} showLabel={false} />
                </div>
                <div>
                  <p className="text-xs text-text-3">Price</p>
                  <p className="text-2xl font-semibold text-text">{formatUsd(m.listPriceCents)}</p>
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-text-3">Quarterly rebate</dt><dd className="font-medium text-text">{formatUsd(perQuarter)} × {p.installments}</dd></div>
                  <div className="flex justify-between"><dt className="text-text-3">Total rebate</dt><dd className="font-medium text-text">{formatUsd(m.rebateTotalCents)}</dd></div>
                  <div className="flex justify-between border-t border-border pt-1.5"><dt className="text-text-3">Net price</dt><dd className="font-semibold text-text">{formatUsd(m.netPriceCents)}</dd></div>
                  <div className="flex justify-between"><dt className="text-text-3">Term</dt><dd className="font-medium text-text">{p.termMonths} months</dd></div>
                </dl>
                <p className="text-xs text-text-3">
                  {slot?.opened ? `${slot.remaining} of ${slot.limit} slots left this month.` : `Up to ${DEFAULT_SLOTS_PER_MONTH} contracts open each month, set by AT24.`}
                </p>
                <div className="mt-auto">
                  <BuyContract productKey={key} productName={p.name} blockedReason={blocked} />
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold text-text">How the rebate works</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
          <li>The rebate is a fixed amount written into your contract at purchase. It is part of the price you paid, not a share of anyone&apos;s results.</li>
          <li>It is credited in 4 quarterly instalments while your Pro plan and identity check are in good standing. If either lapses, instalments are paused and kept for you, not removed.</li>
          <li>Credited amounts can be withdrawn in USDT after a {HOLD_DAYS}-day hold. Withdrawals need an active Pro plan and a verified identity.</li>
          <li>All sales are final once your licence is issued, with the exceptions in the <a className="underline" href="/company/refund-policy">refund policy</a>.</li>
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Member badge</h2>
        <p className="text-sm text-text-2">Active contract holders get a diamond next to their name on this page. It shows your tier only. It is not shown publicly.</p>
        <div className="flex flex-wrap gap-6">
          {REWARD_PRODUCT_KEYS.map((key) => <MemberBadge key={key} tier={key} />)}
        </div>
      </Card>

      {contracts.length > 0 || balances.available + balances.holding + balances.frozen + balances.paid > 0 ? (
        <WithdrawCard
          balances={balances}
          payouts={payouts.map((p) => ({ id: p.id, amountCents: p.amountCents, network: p.network, status: p.status, txRef: p.txRef, createdAt: p.createdAt.toISOString() }))}
          minCents={MIN_PAYOUT_CENTS}
          holdDays={HOLD_DAYS}
          withdrawalsOpen={withdrawalsEnabled()}
          blockedReason={!proOk ? "An active paid Pro plan is needed to withdraw." : !kycOk ? "Identity verification is needed to withdraw." : null}
        />
      ) : null}

      <ReferralCard
        initialLink={refCode ? referralLink(refCode, siteOrigin) : null}
        blockedReason={canEarnReferral(facts, now) ? null : "An active paid Pro plan and a verified identity are needed to get a referral link."}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">Your contracts</h2>
          {myBadge && <MemberBadge tier={myBadge.tier} dimmed={myBadge.dimmed} />}
        </div>
        {contracts.length === 0 ? (
          <EmptyState title="No contracts yet" description="Your contract, product download and rebate schedule will appear here after purchase." />
        ) : (
          <div className="space-y-4">
            {contracts.map((c) => {
              const mine = installments.filter((i) => i.contractId === c.id);
              const name = isRewardProductKey(c.productKey) ? REWARD_PRODUCTS[c.productKey].name : c.productKey;
              return (
                <Card key={c.id} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-text">{name}</h3>
                      <p className="text-xs text-text-3">{c.startsAt.toISOString().slice(0, 10)} to {c.endsAt.toISOString().slice(0, 10)} · Price {formatUsd(c.listPriceCents)} · Net {formatUsd(c.netPriceCents)}</p>
                    </div>
                    <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "PENDING_DOCUMENT" ? "warning" : "neutral"}>{c.status === "PENDING_DOCUMENT" ? "Preparing documents" : c.status.toLowerCase()}</Badge>
                  </div>
                  <ul className="divide-y divide-border text-sm">
                    {mine.map((i) => (
                      <li key={i.id} className="flex justify-between py-1.5">
                        <span className="text-text-2">Rebate {i.seq} · due {i.dueAt.toISOString().slice(0, 10)}</span>
                        <span className="font-medium text-text">{formatUsd(i.amountCents)} <span className="text-xs text-text-3">{i.status.toLowerCase()}</span></span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-3">
                    <ButtonLink href="/dashboard/licenses" variant="secondary" size="sm">Download product</ButtonLink>
                    {c.status !== "PENDING_DOCUMENT" && <ButtonLink href={`/api/private/rewards/contracts/${c.id}/document`} variant="secondary" size="sm">Download contract</ButtonLink>}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
