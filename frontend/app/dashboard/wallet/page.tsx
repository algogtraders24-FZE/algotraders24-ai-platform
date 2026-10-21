// app/dashboard/wallet/page.tsx
// The member's wallet: the balance and USDT withdrawal, where the money came from (referral commission by type of purchase) and a full
// history of every movement. Other people are only shown masked. Algo Contracts is no longer offered, so contract rebates are not shown.
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import WithdrawCard from "@/components/rewards/WithdrawCard";
import PayoutAddressCard from "@/components/rewards/PayoutAddressCard";
import { requireUser } from "@/lib/auth/protectedRoute";
import { loadUserFacts, rewardsOpenFor } from "@/lib/rewards/access";
import { holdDays, minPayoutCents, referralAllProductsEnabled, withdrawalsEnabled } from "@/lib/rewards/config";
import { isIdentityVerified, isProActive } from "@/lib/rewards/eligibility";
import { formatUsd } from "@/lib/rewards/money";
import { getBalances, listPayouts } from "@/services/rewards/payoutStore";
import { loadWallet } from "@/services/rewards/walletStore";
import { getAddressView } from "@/services/rewards/addressStore";

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

  if (!referralAllProductsEnabled() && !rewardsOpenFor(user.email)) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Account" title="Wallet" description="Your balance, where it came from, and your withdrawals." />
        <EmptyState title="Not open for your account yet" description="Your wallet appears here once referral earnings are open for your account." />
      </div>
    );
  }

  const now = new Date();
  const facts = await loadUserFacts(user.id, user.email);
  const proOk = isProActive(facts.subscription, now);
  const kycOk = isIdentityVerified(facts.identity);
  const [balances, payouts, wallet, addressView] = await Promise.all([
    getBalances(user.id).catch(() => EMPTY_BALANCES),
    listPayouts(user.id).catch(() => []),
    loadWallet(user.id),
    getAddressView(user.id).catch(() => null),
  ]);
  const { entries, totals } = wallet;
  // "Credited" = already released or paid out to the member; "coming" = still scheduled, on hold or paused.
  const credited = entries.filter((e) => e.counts && e.kind !== "WITHDRAWAL" && ["Released", "Paid out"].includes(e.statusLabel)).reduce((s, e) => s + e.amountCents, 0);
  const coming = entries.filter((e) => e.counts && e.kind !== "WITHDRAWAL" && !["Released", "Paid out"].includes(e.statusLabel)).reduce((s, e) => s + e.amountCents, 0);

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Wallet"
        description="Your balance, where every amount came from, and your withdrawals."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Balance and withdrawals</h2>
        <PayoutAddressCard initial={addressView ? { network: addressView.network, masked: addressView.masked, activeFrom: addressView.activeFrom, status: addressView.status } : null} />
        <WithdrawCard
          address={addressView}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label="Referral: your direct sales" value={formatUsd(totals.referralDirect)} hint="People you brought yourself (2%)" />
          <Tile label="Credited so far" value={formatUsd(credited)} hint="Released or paid out to you" />
        </div>
        <Card className="space-y-1">
          <p className="text-sm font-medium text-text">Referral commission by what was bought</p>
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            <Tile label="Products" value={formatUsd(totals.byType.products)} />
            <Tile label="Pro plan payments" value={formatUsd(totals.byType.subscriptions)} />
          </div>
          <p className="pt-2 text-xs text-text-3">Credited to you so far {formatUsd(credited)}. Still coming (scheduled or on hold) {formatUsd(coming)}. Withdrawn or requested {formatUsd(totals.withdrawn)}. Cancelled and reversed amounts are not counted.</p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">History</h2>
        {entries.length === 0 ? (
          <EmptyState title="Nothing here yet" description="Your referral commission appears here, each with its source." />
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
