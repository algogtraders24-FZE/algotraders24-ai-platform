// app/dashboard/rewards/page.tsx
// AT24 Rewards & Partner Program - the member's own page (docs/REWARDS-PARTNER-PROGRAM-SPEC.md).
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
        <PageHeader eyebrow="Account" title="Rewards" description="The AT24 Rewards program." />
        <EmptyState title="Not open for your account yet" description="We will let you know when the Rewards program opens." />
      </div>
    );
  }

  const facts = await loadUserFacts(user.id, user.email);
  const now = new Date();
  const proOk = isProActive(facts.subscription, now);
  const kycOk = isIdentityVerified(facts.identity);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Rewards"
        description="12-month AI Algo contracts for Pro members. Each contract includes the product, a signed licence, and a fixed quarterly rebate on the price you pay."
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
                <p className="text-xs text-text-3">Up to {DEFAULT_SLOTS_PER_MONTH} contracts open each month, set by AT24.</p>
                <div className="mt-auto">
                  <span className="inline-flex w-full items-center justify-center rounded-control border border-border px-4 py-2 text-sm text-text-3">Opens soon</span>
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Your contracts</h2>
        <EmptyState title="No contracts yet" description="Your contract, product download and rebate schedule will appear here after purchase." />
      </section>
    </div>
  );
}
