"use client";
// components/admin/AdminRewardsClient.tsx
// Admin screen for Algo Contracts: monthly slots, reserve vs owed, contracts (cancel with a reason), open USDT withdrawals
// (mark paid with a tx reference, or reject), and checkouts whose fulfilment failed after a confirmed payment.
import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

interface Slot { limit: number; opened: boolean; remaining: number }
interface Product { key: string; name: string; enabled: boolean; listingId: string | null; slot: Slot | null }
interface Overview {
  month: string;
  products: Product[];
  reserve: { reserved: number; released: number; returned: number; outstanding: number; owedCents: number; shortfallCents: number; balanced: boolean };
  contracts: Array<{ id: string; email: string; productKey: string; status: string; listPriceCents: number; rebateTotalCents: number; startsAt: string; endsAt: string }>;
  payouts: Array<{ id: string; email: string; amountCents: number; network: string; address: string; createdAt: string }>;
  failedCheckouts: Array<{ id: string; intentId: string; userId: string; productKey: string; error: string | null; createdAt: string }>;
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== "ok") throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json.data;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div>
      <p className="text-xs text-text-3">{label}</p>
      <p className={`text-lg font-semibold ${tone === "bad" ? "text-danger" : "text-text"}`}>{value}</p>
    </div>
  );
}

export default function AdminRewardsClient() {
  const [month, setMonth] = useState<string>("");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [tx, setTx] = useState<Record<string, string>>({});

  const load = useCallback(async (m?: string) => {
    try {
      const d = (await call(`/api/private/admin/rewards/overview${m ? `?month=${m}` : ""}`, "GET")) as Overview;
      setData(d);
      setMonth(d.month);
      setLimits(Object.fromEntries(d.products.map((p) => [p.key, p.slot?.limit ?? 0])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load(month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    }
  }

  if (!data) return <div className="text-sm text-text-3">{error ?? "Loading..."}</div>;
  const r = data.reserve;
  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Reserve</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Reserved in total" value={usd(r.reserved)} />
          <Stat label="Released to members" value={usd(r.released)} />
          <Stat label="Returned (cancelled)" value={usd(r.returned)} />
          <Stat label="Held now" value={usd(r.outstanding)} />
          <Stat label="Still owed" value={usd(r.owedCents)} tone={r.balanced ? undefined : "bad"} />
        </div>
        {r.balanced ? <Badge tone="success">Reserve matches what is owed</Badge> : <Alert tone="danger">Reserve does not match what is owed. Shortfall {usd(r.shortfallCents)}. Check before paying anything out.</Alert>}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Monthly slots</h2>
          <div className="flex items-center gap-2">
            <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" aria-label="Month" className="w-32" />
            <Button variant="secondary" size="sm" onClick={() => load(month)}>Load month</Button>
          </div>
        </div>
        <p className="text-xs text-text-3">A month can hold at most 10 contracts in total across all products. Closing a month does not affect contracts already sold.</p>
        <ul className="divide-y divide-border">
          {data.products.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-text">{p.name}</p>
                <p className="text-xs text-text-3">
                  {p.slot ? `${p.slot.remaining} of ${p.slot.limit} left · ${p.slot.opened ? "open" : "closed"}` : "not set for this month"} ·{" "}
                  {p.enabled && p.listingId ? "product live" : "product not enabled yet"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} max={10} value={limits[p.key] ?? 0} onChange={(e) => setLimits({ ...limits, [p.key]: Number(e.target.value) })} aria-label={`${p.name} limit`} className="w-20" />
                <Button size="sm" onClick={() => act(() => call("/api/private/admin/rewards/slots", "POST", { month, productKey: p.key, limit: limits[p.key] ?? 0, opened: true }), `${p.name}: open with ${limits[p.key] ?? 0} slots.`)}>Open</Button>
                <Button size="sm" variant="secondary" onClick={() => act(() => call("/api/private/admin/rewards/slots", "POST", { month, productKey: p.key, limit: limits[p.key] ?? 0, opened: false }), `${p.name}: closed.`)}>Close</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Open withdrawals</h2>
        {data.payouts.length === 0 ? <p className="text-sm text-text-3">None waiting.</p> : (
          <ul className="divide-y divide-border">
            {data.payouts.map((p) => (
              <li key={p.id} className="space-y-2 py-3">
                <p className="text-sm text-text"><strong>{usd(p.amountCents)}</strong> · {p.email} · {p.network} · {p.createdAt.slice(0, 10)}</p>
                <code className="block break-all rounded-control border border-border bg-ink-3 px-2 py-1 text-xs text-text-2">{p.address}</code>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={tx[p.id] ?? ""} onChange={(e) => setTx({ ...tx, [p.id]: e.target.value })} placeholder="USDT transaction reference" aria-label="Transaction reference" className="w-72" />
                  <Button size="sm" disabled={(tx[p.id] ?? "").trim().length < 6} onClick={() => act(() => call("/api/private/admin/rewards/payouts", "POST", { payoutId: p.id, decision: "PAID", txRef: tx[p.id] }), "Marked as paid.")}>Mark paid</Button>
                  <Button size="sm" variant="secondary" onClick={() => { const note = window.prompt("Reason for rejecting (the amount returns to the member's balance):") ?? ""; if (note.trim()) void act(() => call("/api/private/admin/rewards/payouts", "POST", { payoutId: p.id, decision: "REJECTED", note }), "Rejected; amount returned to the balance."); }}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Contracts (latest 50)</h2>
        {data.contracts.length === 0 ? <p className="text-sm text-text-3">No contracts yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {data.contracts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-text-2">{c.email} · {c.productKey} · {usd(c.listPriceCents)} · {c.startsAt.slice(0, 10)} to {c.endsAt.slice(0, 10)}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "REVOKED" ? "danger" : "warning"}>{c.status.toLowerCase().replace("_", " ")}</Badge>
                  {c.status !== "REVOKED" && (
                    <Button size="sm" variant="secondary" onClick={() => { const reason = window.prompt("Reason for cancelling this contract (recorded in the audit log):") ?? ""; if (reason.trim().length >= 5) void act(() => call(`/api/private/admin/rewards/contracts/${c.id}/cancel`, "POST", { reason }), "Contract cancelled."); }}>Cancel</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.failedCheckouts.length > 0 && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-text">Paid, but the contract was not completed</h2>
          <p className="text-xs text-text-3">The payment and licence are fine. Retry finishes the contract; it is safe to repeat and cannot create a second contract or commission.</p>
          <ul className="divide-y divide-border text-sm">
            {data.failedCheckouts.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-text-2">{f.createdAt.slice(0, 10)} · intent {f.intentId} · {f.productKey} · {f.error ?? "no detail"}</span>
                <Button size="sm" variant="secondary" onClick={() => act(() => call("/api/private/admin/rewards/checkouts/retry", "POST", { checkoutId: f.id }), "Contract completed.")}>Retry</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
