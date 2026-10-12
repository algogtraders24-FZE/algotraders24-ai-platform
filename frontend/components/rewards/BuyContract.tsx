"use client";
// components/rewards/BuyContract.tsx
// The purchase control on a contract card: two consent boxes (contract terms, refund policy), then a server call that returns
// the payment invoice. The server re-checks everything; this only collects consent and shows the answer.
import { useState } from "react";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";

export default function BuyContract({ productKey, productName, blockedReason }: { productKey: string; productName: string; blockedReason?: string | null }) {
  const [terms, setTerms] = useState(false);
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (blockedReason) {
    return <span className="inline-flex w-full items-center justify-center rounded-control border border-border px-4 py-2 text-center text-sm text-text-3">{blockedReason}</span>;
  }

  async function buy() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/private/rewards/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productKey, acceptTerms: terms, acceptRefundPolicy: refund }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      window.location.href = body.data.invoiceUrl as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the purchase.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-xs text-text-2">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5" />
        <span>I have read the 12-month contract terms for {productName}, including the fixed rebate schedule and the net price.</span>
      </label>
      <label className="flex items-start gap-2 text-xs text-text-2">
        <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} className="mt-0.5" />
        <span>
          I understand that sales are final once my licence is issued, except in the cases listed in the{" "}
          <a className="underline" href="/company/refund-policy" target="_blank" rel="noreferrer">refund policy</a>.
        </span>
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button onClick={buy} disabled={!terms || !refund || busy} fullWidth>
        {busy ? "Opening payment..." : "Continue to payment"}
      </Button>
    </div>
  );
}
