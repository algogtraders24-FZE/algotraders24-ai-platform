"use client";
// app/demo/StartDemoButton.tsx - starts (or opens) the signed-in user's free 30-day demo, then goes to the demo page with the key and download.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";

export default function StartDemoButton({ product, label }: { product: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/private/trial/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      router.push(`/dashboard/purchases/${body.data.licenseId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <Button onClick={() => void start()} loading={busy}>
        {label}
      </Button>
    </div>
  );
}
