"use client";
// app/marketplace/sell/IdentityVerifyPanel.tsx
// Shown on the sell page when identity verification is switched on and the seller is not verified yet.
// "Verify identity" asks our server for a one-time Sumsub link and opens it. The documents never touch AT24.
import { useState } from "react";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";

export default function IdentityVerifyPanel({ status, message }: { status: string; message: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/private/seller/identity", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      if (body.data.verified) {
        window.location.reload();
        return;
      }
      window.location.href = body.data.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the verification.");
      setBusy(false);
    }
  }

  const pending = status === "PENDING";
  return (
    <div className="space-y-3 rounded-card border border-border bg-ink-2 p-5">
      <h2 className="text-lg font-semibold text-text">Verify your identity</h2>
      <p className="text-sm text-text-2">{message}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {status !== "REJECTED" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void start()} loading={busy}>{pending ? "Open the verification again" : status === "RETRY" ? "Try again" : "Verify identity"}</Button>
          {pending && <Button variant="secondary" onClick={() => window.location.reload()}>Refresh status</Button>}
        </div>
      )}
      <p className="text-xs text-text-3">Verified sellers get an &quot;Identity verified&quot; mark on their listings. We store only the result (passed or not), never the document.</p>
    </div>
  );
}
