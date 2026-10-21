"use client";
// app/contest/[slug]/EnterContestForm.tsx - enter the contest with one of your Live Sync demo accounts and a public name.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

export interface AccountOption {
  id: string;
  label: string;
}

export default function EnterContestForm({ slug, accounts }: { slug: string; accounts: AccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/private/contests/${slug}/enter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, alias }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={enter} className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <div>
        <label htmlFor="ct-acc" className="mb-1.5 block text-sm font-medium text-text">Your demo account (from Live Sync)</label>
        <Select id="ct-acc" value={accountId} disabled={busy} onChange={(e) => setAccountId(e.target.value)} className="w-full">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="ct-alias" className="mb-1.5 block text-sm font-medium text-text">Public name on the leaderboard</label>
        <Input id="ct-alias" value={alias} disabled={busy} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. TraderRaj" maxLength={24} />
        <p className="mt-1 text-xs text-text-3">3-24 characters. Only this name and your percent result are shown - never your email or account number.</p>
      </div>
      <Button type="submit" loading={busy}>Enter the contest</Button>
    </form>
  );
}
