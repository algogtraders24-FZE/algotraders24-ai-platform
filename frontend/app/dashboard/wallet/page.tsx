// app/dashboard/wallet/page.tsx
// The member's wallet: the balance and USDT withdrawal, where the money came from (contract rebates, referral commission by level and by
// type of purchase) and a full history of every movement. Other people are only shown masked.
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import WithdrawCard from "@/components/rewards/WithdrawCard";
import { requireUser } from "@/lib/auth/protectedRoute";
import { loadUserFacts, rewardsOpenFor } from "@/lib/rewards/access";
import { holdDays, minPayoutCents, withdrawalsEnabled } from "@/lib/rewards/config";
import { isIdentityVerified, isProActive } from "@/lib/rewards/eligibility";
import { formatUsd } from "@/lib/rewards/money";
import { getBalances, listPayouts } from "@/services/rewards/payoutStore";
import { loadWallet } from "@/services/rewards/walletStore";

export const dynamic = "force-dynamic";

const EMPTY_BALANCES = { scheduled: 0, frozen: 0, holding: 0, available: 0, requested: 0, paid: 0, reversed: 0 };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-ink-2 p-4">
      <p className="text-xs text-text-3">{label}</p>
      <p className="mt-1 text-xl font-semibold text-text">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-text-3">{hint}</p>}
    </div>
  );
}

function statusTone(label: string): "success" | "warning" | "danger" | "neutral" {
  if (["Released", "Paid out", "Paid"].includes(label)) return "success";
  if (label === "On hold" || label === "Coming" || label.startsWith("Paused") || label.startsWith("Waiting")) return "warning";
  if (["Cancelled", "Reversed", "Declined"].includes(label)) return "danger";
  return "neutral";
}

export default async function WalletPage() {
  const sessionUser = await requireUser();
  const user = sessionUser.profile;

  if (!rewardsOpenFor(user.email)) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Account" title="Wallet" description="Your balance, where it came from, and your withdrawals." />
        <EmptyState title="Not open for your account yet" description="Your wallet appears here once Algo Contracts and referrals are open for your account." />
      </div>
    );
  }

  const now = new Date();
  const facts = await loadUserFacts(user.id, user.email);
  const proOk = isProActive(facts.subscription, now);
  const kycOk = isIdentityVerified(facts.identity);
  const [balances, payouts, wallet] = await Promise.all([
    getBalances(user.id).catch(() => EMPTY_BALANCES),
    listPayouts(user.id).catch(() => []),
    loadWallet(user.id),
  ]);
  const { entries, totals } = wallet;
  const earned = totals.rebates + totals.referralDirect + totals.referralTeam;

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Wallet"
        description="Your balance, where every amount came from, and your withdrawals."
        action={<ButtonLink href="/dashboard/algo-contracts" variant="secondary" size="sm">Algo Contracts</ButtonLink>}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Balance and withdrawals</h2>
        <WithdrawCard
          balances={balances}
          payouts={payouts.map((p) => ({ id: p.id, amountCents: p.amountCents, network: p.network, status: p.status, txRef: p.txRef, createdAt: p.createdAt.toISOString() }))}
          minCents={minPayoutCents()}
          holdDays={holdDays()}
          withdrawalsOpen={withdrawalsEnabled()}
          blockedReason={!proOk ? "An active paid Pro plan is needed to withdraw." : !kycOk ? "Identity verification is needed to withdraw." : null}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Where your money came from</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Contract rebates" value={formatUsd(totals.rebates)} hint="Fixed instalments of your own contracts" />
          <Tile label="Referral: your direct sales" value={formatUsd(totals.referralDirect)} hint="People you brought yourself" />
          <Tile label="Referral: your team" value={formatUsd(totals.referralTeam)} hint="Levels 2 to 4 above you" />
        </div>
        <Card className="space-y-1">
          <p className="text-sm font-medium text-text">Referral commission by what was bought</p>
          <div className="grid gap-3 pt-1 sm:grid-cols-3">
            <Tile label="Algo Contracts" value={formatUsd(totals.byType.contracts)} />
            <Tile label="Products" value={formatUsd(totals.byType.products)} />
            <Tile label="Pro plan payments" value={formatUsd(totals.byType.subscriptions)} />
          </div>
          <p className="pt-2 text-xs text-text-3">Total earned so far {formatUsd(earned)}. Withdrawn or requested {formatUsd(totals.withdrawn)}. Cancelled and reversed amounts are not counted.</p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">History</h2>
        {entries.length === 0 ? (
          <EmptyState title="Nothing here yet" description="Rebates from your contracts and referral commission appear here, each with its source." />
        ) : (
          <Card padding="none" className="divide-y divide-border">
            {entries.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{e.title}</p>
                  <p className="truncate text-xs text-text-3">{e.detail} - {e.at.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(e.statusLabel)}>{e.statusLabel}</Badge>
                  <span className={`w-24 text-right text-sm font-semibold ${e.amountCents < 0 ? "text-text-2" : "text-text"}`}>{e.amountCents < 0 ? "-" : "+"}{formatUsd(Math.abs(e.amountCents))}</span>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
