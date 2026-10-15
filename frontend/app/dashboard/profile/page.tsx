// app/dashboard/profile/page.tsx
// The member's own profile: who they are, their standing (plan, identity check, Algo Contracts badge), their referral link and a
// short balance summary, with links to where each thing is changed. Read-only: editing stays in Settings, money stays in Algo Contracts.
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import PageHeader from "@/components/ui/PageHeader";
import MemberBadge from "@/components/rewards/MemberBadge";
import ReferralCard from "@/components/rewards/ReferralCard";
import { requireUser } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { PLAN_LABELS } from "@/config/billing.config";
import type { PlanId } from "@/types/billing";
import { loadUserFacts, rewardsOpenFor } from "@/lib/rewards/access";
import { badgeFor } from "@/lib/rewards/badge";
import { isRewardProductKey, referralAllProductsEnabled } from "@/lib/rewards/config";
import { isIdentityVerified, isProActive } from "@/lib/rewards/eligibility";
import { formatUsd } from "@/lib/rewards/money";
import { referralLink } from "@/lib/rewards/referral";
import { getBalances } from "@/services/rewards/payoutStore";
import { ensureReferralCode } from "@/services/rewards/referralStore";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-text-3">{label}</span>
      <span className="text-right text-sm text-text">{children}</span>
    </div>
  );
}

export default async function ProfilePage() {
  const sessionUser = await requireUser();
  const user = sessionUser.profile;
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || "?";
  const planLabel = PLAN_LABELS[user.planId as PlanId] ?? user.planId;
  const now = new Date();

  const facts = await loadUserFacts(user.id, user.email).catch(() => null);
  const proOk = facts ? isProActive(facts.subscription, now) : false;
  const kycOk = facts ? isIdentityVerified(facts.identity) : false;

  // Algo Contracts details only for accounts the program is open for. Every read falls back to "nothing yet" if the tables are missing.
  const rewardsOpen = rewardsOpenFor(user.email);
  // Every account gets its own referral link automatically (earning on it needs an active paid Pro plan when the buyer pays).
  const refCode = await ensureReferralCode(user.id).catch(() => null);
  const [contracts, balances] = rewardsOpen
    ? await Promise.all([
        prisma.rewardContract.findMany({ where: { userId: user.id }, select: { productKey: true, status: true } }).catch(() => []),
        getBalances(user.id).catch(() => null),
      ])
    : [[], null];
  const badge = badgeFor(contracts.filter((c) => isRewardProductKey(c.productKey)).map((c) => ({ productKey: c.productKey as never, status: c.status as never })));
  const link = refCode ? referralLink(refCode, process.env.NEXT_PUBLIC_SITE_URL || undefined) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow="Account" title="Profile" description="Your account at a glance. Change your details in Settings." />

      <Card padding="lg">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xl font-bold text-gold">{initial}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-text">{user.name || user.email}</h2>
              {badge && <MemberBadge tier={badge.tier} dimmed={badge.dimmed} />}
            </div>
            <p className="truncate text-sm text-text-3">{user.email}</p>
          </div>
        </div>
        <div className="mt-4">
          <Row label="Plan"><Badge tone="gold">{planLabel}</Badge></Row>
          <Row label="Joined">{new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</Row>
          <Row label="Email">{user.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}</Row>
          <Row label="Identity check (KYC)">{kycOk ? <Badge tone="success">Verified</Badge> : <Badge tone="neutral">Not verified</Badge>}</Row>
          {rewardsOpen && <Row label="Paid Pro plan">{proOk ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Not active</Badge>}</Row>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/dashboard/settings" variant="secondary" size="sm">Edit profile and security</ButtonLink>
          <ButtonLink href="/dashboard/billing" variant="secondary" size="sm">Plan and billing</ButtonLink>
        </div>
      </Card>

      {rewardsOpen && (
        <>
          <Card padding="lg" className="space-y-3">
            <h2 className="text-base font-semibold text-text">Wallet</h2>
            <div>
              <Row label="Available to withdraw">{balances ? formatUsd(balances.available) : "$0.00"}</Row>
              <Row label="On hold or scheduled">{balances ? formatUsd(balances.holding + balances.scheduled) : "$0.00"}</Row>
              <Row label="Algo Contracts">{contracts.length === 0 ? "None yet" : `${contracts.filter((c) => c.status === "ACTIVE").length} active of ${contracts.length}`}</Row>
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/dashboard/wallet" variant="secondary" size="sm">Open wallet and history</ButtonLink>
              <ButtonLink href="/dashboard/algo-contracts" variant="secondary" size="sm">Open Algo Contracts</ButtonLink>
            </div>
            <p className="text-xs text-text-3">The wallet shows where every amount came from: contract rebates and referral commission, by level and by what was bought.</p>
          </Card>
        </>
      )}

      <ReferralCard initialLink={link} blockedReason={null} allProducts={referralAllProductsEnabled()} />

      <Card padding="lg">
        <h2 className="text-base font-semibold text-text">Shortcuts</h2>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <li><Link href="/dashboard/wallet" className="text-gold hover:underline">Wallet</Link></li>
          <li><Link href="/dashboard/licenses" className="text-gold hover:underline">My licenses</Link></li>
          <li><Link href="/dashboard/purchases" className="text-gold hover:underline">My purchases</Link></li>
          <li><Link href="/dashboard/settings" className="text-gold hover:underline">Settings</Link></li>
          <li><Link href="/dashboard/support" className="text-gold hover:underline">AT24 Copilot</Link></li>
        </ul>
      </Card>
    </div>
  );
}
