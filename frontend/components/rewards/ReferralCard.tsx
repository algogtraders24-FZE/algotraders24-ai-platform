"use client";
// components/rewards/ReferralCard.tsx
// The member's referral link. The code is random (never the username) and is created on first use.
import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";

export default function ReferralCard({ initialLink, blockedReason }: { initialLink: string | null; blockedReason: string | null }) {
  const [link, setLink] = useState<string | null>(initialLink);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/private/rewards/referral", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setLink(body.data.link as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create your link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold text-text">Your referral link</h2>
      <p className="text-sm text-text-2">
        Share this link. When someone joins through it and pays for a product or a Pro plan, you earn 2% of what they pay, including every renewal. It is credited once the payment is confirmed.{" "}
        The link uses a random code, never your name or username. You cannot earn from your own purchases. Your link is created automatically; to be paid commission you need an active paid Pro plan when your buyer pays, and a verified identity to withdraw.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {blockedReason ? (
        <p className="text-sm text-text-3">{blockedReason}</p>
      ) : link ? (
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-control border border-border bg-ink-3 px-3 py-2 text-sm text-text">{link}</code>
          <Button variant="secondary" size="sm" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
        </div>
      ) : (
        <Button onClick={create} disabled={busy}>{busy ? "Creating..." : "Create my referral link"}</Button>
      )}
    </Card>
  );
}
