"use client";
// app/dashboard/earnings/page.tsx
// Seller self-serve Phase 4: what the seller has earned, what is still on hold, and the USDT payout request.
// Numbers come from the ledger (one row per sale); nothing here is estimated except the gateway fee, which is fixed per sale.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

interface Summary { holding: number; available: number; requested: number; paid: number; reversed: number }
interface Sale { id: string; listingTitle: string; grossAmount: number; commissionAmount: number; gatewayFee: number; netAmount: number; status: string; availableAt: string; createdAt: string }
interface Payout { id: string; amount: number; network: string; address: string; status: string; txRef: string | null; note: string | null; createdAt: string }
interface View { summary: Summary; sales: Sale[]; payouts: Payout[]; rules: { commissionRate: number; holdDays: number; minPayoutUsd: number; networks: string[] } }

const usd = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
const day = (s: string) => s.slice(0, 10);

export default function EarningsPage() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [network, setNetwork] = useState("TRC20");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/seller/earnings", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setView(body.data as View);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your earnings.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function request() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/private/seller/earnings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ network, address }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setNotice(`Payout of ${usd(body.data.amount)} requested. It is paid by hand after a quick check, usually within a few days.`);
      setAddress("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request the payout.");
    } finally {
      setBusy(false);
    }
  }

  const s = view?.summary;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="SELLER" title="Your earnings" description="Money from sales of your marketplace listings." />
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {view && s && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Available now" value={usd(s.available)} strong />
            <Stat label={`On hold (${view.rules.holdDays} days)`} value={usd(s.holding)} />
            <Stat label="In a payout request" value={usd(s.requested)} />
            <Stat label="Paid out" value={usd(s.paid)} />
          </div>

          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-semibold text-text">Request a payout</h2>
            <p className="text-sm text-text-2">
              AT24 keeps {view.rules.commissionRate * 100}% of each sale plus the payment-gateway fee. Each sale is held for {view.rules.holdDays} days (refund window),
              then it becomes available. Payouts are in USDT, minimum {usd(view.rules.minPayoutUsd)}, and pay out your whole available balance at once.
              Double-check the address and network: a transfer to a wrong address cannot be recovered.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr_auto]">
              <Select value={network} disabled={busy} onChange={(e) => setNetwork(e.target.value)} className="w-full">
                {view.rules.networks.map((n) => <option key={n} value={n}>USDT on {n}</option>)}
              </Select>
              <Input value={address} disabled={busy} onChange={(e) => setAddress(e.target.value)} placeholder={network === "TRC20" ? "T... (Tron address)" : "0x... (wallet address)"} />
              <Button onClick={() => void request()} loading={busy} disabled={s.available < view.rules.minPayoutUsd || address.trim() === ""}>Request payout</Button>
            </div>
            {s.available < view.rules.minPayoutUsd && <p className="text-xs text-text-3">You need at least {usd(view.rules.minPayoutUsd)} available to request a payout.</p>}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-semibold text-text">Sales</h2>
            {view.sales.length === 0 ? (
              <p className="text-sm text-text-3">No sales yet. When someone buys one of your listings it appears here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-3"><th className="py-1.5 font-medium">Date</th><th className="font-medium">Listing</th><th className="text-right font-medium">Price</th><th className="text-right font-medium">AT24 commission</th><th className="text-right font-medium">Gateway fee</th><th className="text-right font-medium">You get</th><th className="font-medium pl-3">Status</th></tr></thead>
                  <tbody>
                    {view.sales.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="py-1.5 text-text-2">{day(e.createdAt)}</td>
                        <td className="text-text">{e.listingTitle}</td>
                        <td className="text-right tabular-nums">{e.grossAmount.toFixed(2)}</td>
                        <td className="text-right tabular-nums">-{e.commissionAmount.toFixed(2)}</td>
                        <td className="text-right tabular-nums">-{e.gatewayFee.toFixed(2)}</td>
                        <td className="text-right font-semibold tabular-nums text-text">{e.netAmount.toFixed(2)}</td>
                        <td className="pl-3"><Badge tone={e.status === "PAID" ? "success" : e.status === "REVERSED" ? "danger" : "neutral"}>{e.status === "PENDING" ? (new Date(e.availableAt) > new Date() ? `holds until ${day(e.availableAt)}` : "available") : e.status.toLowerCase()}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {view.payouts.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="text-lg font-semibold text-text">Payout requests</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-3"><th className="py-1.5 font-medium">Requested</th><th className="text-right font-medium">Amount</th><th className="pl-3 font-medium">Network</th><th className="font-medium">Status</th><th className="font-medium">Transaction / note</th></tr></thead>
                  <tbody>
                    {view.payouts.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="py-1.5 text-text-2">{day(p.createdAt)}</td>
                        <td className="text-right tabular-nums">{usd(p.amount)}</td>
                        <td className="pl-3">{p.network}</td>
                        <td><Badge tone={p.status === "PAID" ? "success" : p.status === "REJECTED" ? "danger" : "neutral"}>{p.status.toLowerCase()}</Badge></td>
                        <td className="break-all text-xs text-text-3">{p.txRef ?? p.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wide text-text-3">{label}</p>
      <p className={`mt-1 ${strong ? "text-xl text-gold" : "text-lg text-text"} font-semibold tabular-nums`}>{value}</p>
    </Card>
  );
}
