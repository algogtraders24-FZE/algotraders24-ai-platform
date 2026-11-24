"use client";
// components/exec-bridge/ExecEaCard.tsx
// Live Sync page: the AT24 Execute EA. Create (and revoke) the token for the user's own terminal, download the EA, and see the setup steps. The EA places an
// order in the user's own MetaTrader only after the user presses Confirm in the Pro Chart. Hidden entirely while the bridge is not open to this account.
import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

interface DeviceRow { id: string; name: string; prefix: string; createdAt: string; revokedAt: string | null; lastSeenAt: string | null }

const when = (d: string | null) => (d ? new Date(d).toLocaleString() : "never");

export default function ExecEaCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [name, setName] = useState("My MT5 terminal");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/private/exec/devices", { cache: "no-store" });
      const j = await r.json();
      if (j?.status === "ok") { setEnabled(j.data.enabled === true); setDevices(j.data.devices ?? []); }
      else setEnabled(false);
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/private/exec/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, consent }) });
      const j = await r.json();
      if (j?.status === "ok") { setToken(j.data.token as string); setConsent(false); await load(); }
      else setError(j?.error?.message ?? "Could not create the token.");
    } catch {
      setError("Could not create the token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this token? The EA using it stops receiving orders at once.")) return;
    await fetch(`/api/private/exec/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  if (!enabled) return null;
  const active = devices.filter((d) => !d.revokedAt);

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text">AT24 Execute EA: send confirmed orders to your own MT5 or MT4</h2>
        <p className="mt-1 text-sm text-text-2">
          A small Expert Advisor that runs inside <b>your</b> MetaTrader 5 or 4. When you press <b>Confirm</b> on a trade plan in the Pro Chart, it places that one order in your terminal.
          It never opens a trade on its own, never sees your password, and applies its own safety checks first (stop loss required, lot cap, symbol, price, open-position and daily-loss limits).
          Demo accounts only unless you switch on <code>AllowLiveAccount</code> in its inputs.
        </p>
      </div>

      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text-2">
        <li>Create a token below (shown once).</li>
        <li>
          Download <a className="font-semibold text-gold hover:underline" href="/downloads/AT24Execute.ex5" download>AT24Execute.ex5</a> into your terminal&apos;s <code>MQL5\Experts</code> folder (File → Open Data Folder), refresh the Navigator.
          <span className="block text-xs text-text-3">Source to read or compile yourself: <a className="font-semibold text-gold hover:underline" href="/downloads/AT24Execute.mq5" download>AT24Execute.mq5</a> · <a className="hover:underline" href="/downloads/AT24Execute.manifest.json" target="_blank" rel="noreferrer">checksums</a></span>
          <span className="block text-xs text-text-3">
            MetaTrader 4: download <a className="font-semibold text-gold hover:underline" href="/downloads/AT24Execute-MT4.ex4" download>AT24Execute-MT4.ex4</a> into <code>MQL4\Experts</code> instead, then follow the same steps. Source: <a className="font-semibold text-gold hover:underline" href="/downloads/AT24Execute-MT4.mq4" download>AT24Execute-MT4.mq4</a> · <a className="hover:underline" href="/downloads/AT24Execute-MT4.manifest.json" target="_blank" rel="noreferrer">checksums</a>
          </span>
        </li>
        <li>MetaTrader: Tools → Options → Expert Advisors → tick <b>Allow WebRequest for listed URL</b> and add <code>https://www.algotraders24.ai</code>.</li>
        <li>Attach <b>AT24Execute</b> to ONE chart, paste the token into its inputs, switch <b>Algo Trading</b> on. Start with a demo account; set <code>DryRun=true</code> first if you want to see it read and refuse an order without placing anything.</li>
        <li>In the Pro Chart, open the Trade tab: it shows &quot;EA connected&quot; and the Send button.</li>
      </ol>

      {token && (
        <div className="rounded-control border border-gold/40 bg-gold/5 p-3 text-sm">
          <p className="font-semibold text-text">Your token (copy it now, it is shown only once)</p>
          <code className="mt-1 block break-all rounded bg-ink-3 p-2 text-xs text-text">{token}</code>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(token); }}>Copy</Button>
            <Button size="sm" variant="secondary" onClick={() => setToken(null)}>I have saved it</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-text-2">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>I understand that this EA places orders in my MetaTrader only for orders I confirm in the AT24 chart, and that the orders and their results are stored in my AT24 account.</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Token name" className="rounded-control border border-border bg-ink-3 px-3 py-1.5 text-sm text-text" />
          <Button onClick={create} loading={busy} disabled={!consent}>Create token</Button>
        </div>
        {!consent && <p className="text-xs text-amber-300">Tick the box first: &quot;Create token&quot; stays disabled until you do.</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {devices.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium text-text">{d.name}</span> <code className="text-xs text-text-3">{d.prefix}…</code>
                <span className="block text-xs text-text-3">{d.revokedAt ? `revoked ${when(d.revokedAt)}` : `last seen ${when(d.lastSeenAt)}`}</span>
              </span>
              {!d.revokedAt && <Button size="sm" variant="secondary" onClick={() => void revoke(d.id)}>Revoke</Button>}
            </li>
          ))}
        </ul>
      )}
      {active.length === 0 && devices.length === 0 && <p className="text-xs text-text-3">No token yet.</p>}
    </Card>
  );
}
