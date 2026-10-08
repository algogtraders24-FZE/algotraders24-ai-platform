"use client";
// app/dashboard/admin/seller-payouts/page.tsx
// Seller self-serve Phase 4 - the one admin task in the money flow: send the USDT yourself, then record the transaction id here.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

interface Row { id: string; sellerEmail: string | null; sellerName: string | null; amount: number; network: string; address: string; status: string; txRef: string | null; note: string | null; createdAt: string }

export default function AdminSellerPayoutsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tx, setTx] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/private/admin/seller-payouts", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== "ok") { setError(body?.error?.message ?? `Request failed (${res.status})`); return; }
    setRows(body.data.payouts as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "paid" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const note = action === "reject" ? window.prompt("Reason (shown to the seller):") ?? "" : "";
      const res = await fetch("/api/private/admin/seller-payouts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, txRef: tx[id] ?? "", note }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="ADMIN" title="Seller payouts" description="Send the USDT from your own wallet to the address shown, then paste the transaction id and press Mark paid." />
      {error && <Alert tone="danger">{error}</Alert>}
      <Card className="space-y-3 p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-text-3">No payout requests yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-text">{r.amount.toFixed(2)} USDT</b>
                <Badge tone={r.status === "PAID" ? "success" : r.status === "REJECTED" ? "danger" : "neutral"}>{r.status.toLowerCase()}</Badge>
                <span className="text-text-2">{r.sellerName ?? ""} {r.sellerEmail ? `(${r.sellerEmail})` : ""}</span>
                <span className="text-xs text-text-3">{r.createdAt.slice(0, 16).replace("T", " ")}</span>
              </div>
              <p className="break-all text-text-2"><b>{r.network}</b> · {r.address}</p>
              {r.status === "REQUESTED" ? (
                <div className="flex flex-wrap gap-2">
                  <Input value={tx[r.id] ?? ""} onChange={(e) => setTx((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Transaction id after you sent it" className="min-w-[260px] flex-1" />
                  <Button onClick={() => void act(r.id, "paid")} loading={busyId === r.id} disabled={(tx[r.id] ?? "").trim().length < 6}>Mark paid</Button>
                  <Button variant="secondary" onClick={() => void act(r.id, "reject")} disabled={busyId === r.id}>Reject</Button>
                </div>
              ) : (
                <p className="break-all text-xs text-text-3">{r.txRef ?? r.note ?? ""}</p>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
