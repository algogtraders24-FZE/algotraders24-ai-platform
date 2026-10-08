"use client";
// components/live-sync/AlertsPanel.tsx
// Alert settings for ONE synced account: five alert types, each with an on/off switch, a threshold and where to
// send it (email, the header bell). Alerts only inform; nothing here trades or closes positions.
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

interface Rule {
  kind: string;
  label: string;
  unit: string;
  help: string;
  min: number;
  max: number;
  saved: boolean;
  threshold: number;
  enabled: boolean;
  notifyEmail: boolean;
  notifyBell: boolean;
  cooldownMin: number;
  state: string;
  lastFiredAt: string | null;
}

export default function AlertsPanel({ accountId }: { accountId: string }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/private/live-sync/alerts?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setRules(j.data.rules as Rule[]);
    } catch {
      // The panel simply stays closed if alerts are not available yet.
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(kind: string, change: Partial<Rule>) {
    setRules((rs) => (rs ? rs.map((r) => (r.kind === kind ? { ...r, ...change } : r)) : rs));
  }

  async function save(r: Rule) {
    setBusy(r.kind);
    setMsg(null);
    try {
      const res = await fetch("/api/private/live-sync/alerts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, kind: r.kind, threshold: Number(r.threshold), enabled: r.enabled, notifyEmail: r.notifyEmail, notifyBell: r.notifyBell, cooldownMin: r.cooldownMin }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? "Could not save");
      setMsg({ tone: "success", text: `${r.label}: saved.` });
      await load();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      const res = await fetch("/api/private/live-sync/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? "Could not send the test");
      setMsg({ tone: "success", text: "Test sent: check the bell at the top and your email." });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Could not send the test" });
    } finally {
      setBusy(null);
    }
  }

  if (rules === null) return null;
  const active = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text">
          Alerts <span className="ml-1 text-xs font-normal text-text-3">{active > 0 ? `${active} on` : "none on"}</span>
        </p>
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Set up alerts"}</Button>
      </div>
      {!open && active === 0 && <p className="text-xs text-text-3">Get told by email and in the bell when margin level is low, a daily loss limit is hit, the drawdown grows, or this account stops reporting. They only inform you; AT24 never trades or closes positions.</p>}

      {open && (
        <div className="space-y-3">
          {rules.map((r) => (
            <div key={r.kind} className="space-y-2 rounded-md bg-white/[0.03] p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium text-text">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.kind, { enabled: e.target.checked })} />
                  {r.label}
                  {r.state === "firing" && <Badge tone="warning" className="normal-case">active now</Badge>}
                </label>
                <Button size="sm" variant="secondary" loading={busy === r.kind} onClick={() => void save(r)}>Save</Button>
              </div>
              <p className="text-xs text-text-3">{r.help}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-text-2">
                <label className="flex items-center gap-1.5">
                  Threshold
                  <input
                    type="number"
                    min={r.min}
                    max={r.max}
                    step="any"
                    value={r.threshold}
                    onChange={(e) => patch(r.kind, { threshold: Number(e.target.value) })}
                    className="w-24 rounded-md border border-border bg-ink-2 px-2 py-1 text-sm text-text"
                    aria-label={`${r.label} threshold`}
                  />
                  <span className="text-text-3">{r.unit}</span>
                </label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.notifyEmail} onChange={(e) => patch(r.kind, { notifyEmail: e.target.checked })} /> Email</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.notifyBell} onChange={(e) => patch(r.kind, { notifyBell: e.target.checked })} /> Bell</label>
                <label className="flex items-center gap-1.5">
                  Repeat after
                  <select className="rounded-md border border-border bg-ink-2 px-2 py-1 text-sm text-text" value={r.cooldownMin} onChange={(e) => patch(r.kind, { cooldownMin: Number(e.target.value) })}>
                    {[15, 30, 60, 180, 720, 1440].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ))}
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" loading={busy === "test"} onClick={() => void test()}>Send a test alert</Button>
            <span className="text-xs text-text-3">An alert is sent once when something is breached, then repeated only after the &quot;repeat after&quot; time while it lasts.</span>
          </div>
        </div>
      )}
    </div>
  );
}
