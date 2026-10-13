"use client";
// components/rewards/PayoutAddressCard.tsx
// Where the member's USDT withdrawals are sent. Always visible in the wallet (even with nothing to withdraw yet), so the member sets it up
// before the first payout. A new or changed address waits a short while before it can be used - the server enforces that.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

export interface SavedAddressView { network: string; masked: string; activeFrom: string; status: string }

export default function PayoutAddressCard({ initial }: { initial: SavedAddressView | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedAddressView | null>(initial);
  const [editing, setEditing] = useState(initial === null);
  const [network, setNetwork] = useState(initial?.network ?? "TRC20");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/private/rewards/payout-address", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ network, address }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setSaved(body.data.address);
      setAddress("");
      setEditing(false);
      setNotice(body.data.unchanged ? "That is already your saved address." : body.data.address?.status === "Active" ? "Address saved. Your withdrawals will be sent to it." : `Address saved. ${body.data.address?.status ?? ""}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the address.");
    } finally {
      setBusy(false);
    }
  }

  const active = saved?.status === "Active";
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text">Your USDT withdrawal address</h2>
        {saved && <Badge tone={active ? "success" : "warning"}>{active ? "Active" : "Waiting"}</Badge>}
      </div>
      <p className="text-sm text-text-2">Withdrawals are sent to this address only. Use an address you own on the network you choose; a payment to the wrong network cannot be recovered.</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {saved && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-ink-2 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{saved.network} <code className="ml-1 text-xs">{saved.masked}</code></p>
            <p className="text-xs text-text-3">{saved.status}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => { setEditing(true); setNotice(null); }}>Change address</Button>
        </div>
      )}

      {editing && (
        <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
          <Select value={network} onChange={(e) => setNetwork(e.target.value)} aria-label="Network">
            <option value="TRC20">TRC20 (Tron)</option>
            <option value="ERC20">ERC20 (Ethereum)</option>
            <option value="BEP20">BEP20 (BNB Chain)</option>
          </Select>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Your USDT address" aria-label="USDT address" />
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy || address.trim().length < 10}>{busy ? "Saving..." : "Save address"}</Button>
            {saved && <Button variant="secondary" onClick={() => { setEditing(false); setAddress(""); setError(null); }}>Cancel</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}
