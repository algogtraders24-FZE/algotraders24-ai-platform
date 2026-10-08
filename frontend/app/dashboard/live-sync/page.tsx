"use client";
// app/dashboard/live-sync/page.tsx
// AT24 Live Sync (P1). Connect a MetaTrader 5 terminal with the read-only AT24
// Live Sync Expert Advisor: device tokens, connection status per synced account,
// and deletion of synced data. See docs/LIVE-SYNC-SPEC.md.
//
// Only a salted fingerprint identifies an account; the account number, name and
// server are never sent or shown. The raw device token is displayed ONCE.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import LivePanel from "@/components/live-sync/LivePanel";
import PublishPanel from "@/components/live-results/PublishPanel";

interface DeviceRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}
interface AccountRow {
  id: string;
  label: string;
  mode: string;
  currency: string;
  marginMode: string;
  firstSyncAt: string;
  lastSyncAt: string;
  trades: number;
  batches: number;
  lastBalance: number | null;
  lastEquity: number | null;
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "-");
const num = (n: number | null, cur: string) => (n === null ? "-" : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);

function ago(d: string | null): string {
  if (!d) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default function LiveSyncPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [consent, setConsent] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([
        fetch("/api/private/live-sync/devices", { cache: "no-store" }),
        fetch("/api/private/live-sync/accounts", { cache: "no-store" }),
      ]);
      if (d.status === 503 || a.status === 503) {
        setUnavailable(true);
        return;
      }
      setUnavailable(false);
      if (d.ok) setDevices(((await d.json()).data.devices as DeviceRow[]) ?? []);
      if (a.ok) setAccounts(((await a.json()).data.accounts as AccountRow[]) ?? []);
    } catch {
      setError("Could not load Live Sync status.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  async function createDevice() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/private/live-sync/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, consent }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not create the token");
      setFresh(body.data.token as string);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the token");
    } finally {
      setBusy(false);
    }
  }

  async function call(url: string, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? fallback);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="INTELLIGENCE"
        title="Live Sync"
        description="Connect your MetaTrader 5 terminal with a small read-only Expert Advisor so AT24 can show your trades live. It only reads: it never trades, never sees your broker password, and never sends your account number or name."
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {unavailable && <Alert tone="info">Live Sync is not switched on yet. You will be able to connect a terminal here as soon as it is.</Alert>}

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">How to connect (about 3 minutes)</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-text-2">
          <li>Create a device token below and copy it (shown only once).</li>
          <li>Download the EA <a className="font-semibold text-gold hover:underline" href="/downloads/AT24LiveSync.mq5" download>AT24LiveSync.mq5</a>, copy it into your terminal&apos;s <code>MQL5\Experts</code> folder and compile it in MetaEditor (F7). You can read exactly what it does.</li>
          <li>In MetaTrader 5: <b>Tools → Options → Expert Advisors → Allow WebRequest for listed URL</b>, then add <code>https://www.algotraders24.ai</code>.</li>
          <li>Attach <b>AT24LiveSync</b> to ONE chart, paste your token into its inputs, and allow algo trading. The chart will show &quot;connected&quot;.</li>
        </ol>
        <p className="text-xs text-text-3">
          The EA runs on <b>demo accounts only</b> by default. Reading a live account needs you to switch that input on yourself. Start with a demo account.
        </p>
      </Card>

      {fresh && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-text">Your new device token</p>
          <p className="text-sm text-text-2">Copy it now. It is shown only once and cannot be recovered.</p>
          <code className="block break-all rounded-control border border-border bg-ink-2 p-3 text-xs text-text">{fresh}</code>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fresh);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy token"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setFresh(null)}>I have saved it</Button>
          </div>
        </Card>
      )}

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Device tokens</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name (e.g. Home PC - demo)" aria-label="Device name" />
          <Button onClick={createDevice} loading={busy} disabled={unavailable || !consent}>Create token</Button>
        </div>
        {!consent && <p className="text-xs text-text-3">Tick the box below to enable &quot;Create token&quot;.</p>}
        <label className="flex items-start gap-2 text-sm text-text-2">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>
            I understand that the Live Sync EA is read-only and will send my closed trades, balance, equity and open positions to AT24 (if I switch on a <b className="text-text">real account</b>, that is real account data). It never sends my account number, name, broker or password, and I can revoke the token or delete the synced data at any time.
          </span>
        </label>
        {devices.length === 0 ? (
          <p className="text-sm text-text-2">{loaded ? "No devices yet." : "Loading…"}</p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm">
                  <p className="text-text">
                    {d.name} <span className="font-mono text-xs text-text-3">{d.prefix}…</span>{" "}
                    <Badge tone={d.revokedAt ? "danger" : "success"} className="normal-case">{d.revokedAt ? "Revoked" : "Active"}</Badge>
                  </p>
                  <p className="text-xs text-text-3">Created {fmt(d.createdAt)} · last seen {ago(d.lastSeenAt)}</p>
                </div>
                {!d.revokedAt && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void call(`/api/private/live-sync/devices?id=${encodeURIComponent(d.id)}`, "Could not revoke the token")}>Revoke</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Synced accounts</p>
        {accounts.length === 0 ? (
          <p className="text-sm text-text-2">{loaded ? "Nothing synced yet. Once the EA connects, your account appears here within a minute." : "Loading…"}</p>
        ) : (
          <ul className="divide-y divide-border">
            {accounts.map((a) => (
              <li key={a.id} className="space-y-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 text-sm">
                    <p className="text-text">
                      {a.label} <Badge tone={a.mode === "demo" ? "neutral" : "warning"} className="normal-case">{a.mode}</Badge>{" "}
                      <span className="text-xs text-text-3">{a.marginMode} · {a.currency}</span>
                    </p>
                    <p className="text-xs text-text-3">
                      {a.trades} trades · {a.batches} batches · last sync {ago(a.lastSyncAt)} · balance {num(a.lastBalance, a.currency)} · equity {num(a.lastEquity, a.currency)}
                    </p>
                    {a.mode === "real" && <p className="text-xs text-text-3">Real account: this is your real trading data. Delete it anytime with &quot;Delete synced data&quot;.</p>}
                  </div>
                  <div className="flex gap-2">
                    <ButtonLink size="sm" href={`/dashboard/edge-analyzer?syncedAccount=${encodeURIComponent(a.id)}`}>Analyze edge</ButtonLink>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void call(`/api/private/live-sync/accounts?id=${encodeURIComponent(a.id)}`, "Could not delete the data")}>Delete synced data</Button>
                  </div>
                </div>
                <LivePanel accountId={a.id} />
                <PublishPanel accountId={a.id} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-text-3">Deleting removes this account&apos;s synced trades, history and snapshots permanently. The EA will start fresh if it is still running.</p>
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-semibold text-text">What is sent, and what never is</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
          <li><b className="text-text">Sent:</b> your closed trades (symbol, direction, size, prices, profit, commission, swap), balance and equity, open positions, and basic account facts (currency, demo/real, hedging/netting).</li>
          <li><b className="text-text">Never sent:</b> account number, your name, broker/server name, any password, or anything from other charts.</li>
          <li>Your account is identified only by a salted fingerprint that cannot be turned back into your account number by us.</li>
          <li>This is informational analysis, not investment advice. <Link href="/dashboard/help" className="font-semibold text-gold hover:underline">Guides</Link></li>
        </ul>
      </Card>
    </div>
  );
}
