"use client";
// components/license/ChangeAccountPanel.tsx
// Purchase page: shows which trading account the key is bound to and lets the buyer change it (2 times per 30 days).
import { useCallback, useEffect, useState } from "react";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";

interface Status { boundAccounts: { label: string; since: string }[]; remaining: number; nextAllowedAt: string | null }

export default function ChangeAccountPanel({ licenseId }: { licenseId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/private/licenses/${licenseId}/move-account`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.status === "ok") setStatus(body.data as Status);
    } catch {
      /* the panel simply stays empty */
    }
  }, [licenseId]);
  useEffect(() => { void load(); }, [load]);

  async function change() {
    if (!window.confirm("Free this trading account? The next account that runs the EA with your key will take its place. Use it only when you really changed broker, account or VPS.")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/private/licenses/${licenseId}/move-account`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setNotice("Done. Now attach the EA on your new account; it will take the slot. The old account stops working.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the account.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const bound = status.boundAccounts;
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {bound.length === 0 ? (
        <p className="text-sm text-text-2">No account is using this key yet. The first account that runs the EA takes it.</p>
      ) : (
        <ul className="space-y-1 text-sm text-text-2">
          {bound.map((a) => (
            <li key={a.label + a.since}>Bound to <b className="text-text">{a.label}</b> <span className="text-xs text-text-3">since {a.since.slice(0, 10)}</span></li>
          ))}
        </ul>
      )}
      {bound.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void change()} loading={busy} disabled={status.remaining === 0}>Change trading account</Button>
          <span className="text-xs text-text-3">
            {status.remaining > 0 ? `${status.remaining} change${status.remaining === 1 ? "" : "s"} left in the next 30 days` : status.nextAllowedAt ? `No changes left. Next one possible on ${status.nextAllowedAt.slice(0, 10)}.` : "No changes left right now."}
          </span>
        </div>
      )}
    </div>
  );
}
