"use client";
// components/rewards/WithdrawCard.tsx
// The member's balance and the USDT withdrawal request. Amounts come from the server; the server re-checks every rule on submit.
import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

export interface BalanceView { scheduled: number; frozen: number; holding: number; available: number; requested: number; paid: number }
export interface PayoutView { id: string; amountCents: number; network: string; status: string; txRef: string | null; createdAt: string }

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-text-3">{label}</p>
      <p className={strong ? "text-xl font-semibold text-text" : "text-base font-medium text-text-2"}>{value}</p>
    </div>
  );
}

export default function WithdrawCard({ balances, payouts, minCents, holdDays, withdrawalsOpen, blockedReason, address }: {
  balances: BalanceView; payouts: PayoutView[]; minCents: number; holdDays: number; withdrawalsOpen: boolean; blockedReason: string | null;
  /** The saved withdrawal address (masked), or null when none is saved yet. Saved and changed in the wallet. */
  address: { network: string; masked: string; status: string } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/private/rewards/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setNotice(`Withdrawal of ${usd(body.data.amountCents)} requested. It is paid by hand after a quick check.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request the withdrawal.");
    } finally {
      setBusy(false);
    }
  }

  const addressReady = address !== null && address.status === "Active";
  const canTry = withdrawalsOpen && !blockedReason && balances.available >= minCents && addressReady;
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold text-text">Your balance</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Available now" value={usd(balances.available)} strong />
        <Stat label={`On hold (${holdDays} days)`} value={usd(balances.holding)} />
        <Stat label="Paused (kept for you)" value={usd(balances.frozen)} />
        <Stat label="Coming on schedule" value={usd(balances.scheduled)} />
        <Stat label="Withdrawn" value={usd(balances.paid)} />
      </div>
      {balances.frozen > 0 && <Alert tone="warning">Some rebate is paused because your Pro plan or identity check is not in good standing. It is kept for you and is credited once both are restored.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-text">Withdraw in USDT</h3>
        {!withdrawalsOpen ? (
          <p className="text-sm text-text-3">Withdrawals are not open yet.</p>
        ) : blockedReason ? (
          <p className="text-sm text-text-3">{blockedReason}</p>
        ) : balances.available < minCents ? (
          <p className="text-sm text-text-3">The minimum withdrawal is {usd(minCents)}. You have {usd(balances.available)} available.</p>
        ) : address === null ? (
          <p className="text-sm text-text-3">Save your USDT address first. <a className="text-gold underline" href="/dashboard/wallet">Open your wallet</a> to add it.</p>
        ) : !addressReady ? (
          <p className="text-sm text-text-3">Your address: {address.status}.</p>
        ) : null}
        {canTry && address && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-2">Sent to {address.network} <code className="text-xs">{address.masked}</code>. <a className="text-gold underline" href="/dashboard/wallet">Change</a></p>
            <Button onClick={submit} disabled={busy}>{busy ? "Sending..." : `Withdraw ${usd(balances.available)}`}</Button>
          </div>
        )}
      </div>

      {payouts.length > 0 && (
        <ul className="divide-y divide-border border-t border-border pt-2 text-sm">
          {payouts.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span className="text-text-2">{p.createdAt.slice(0, 10)} · {p.network}</span>
              <span className="flex items-center gap-3">
                <span className="font-medium text-text">{usd(p.amountCents)}</span>
                <Badge tone={p.status === "PAID" ? "success" : p.status === "REJECTED" ? "danger" : "warning"}>{p.status.toLowerCase()}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
