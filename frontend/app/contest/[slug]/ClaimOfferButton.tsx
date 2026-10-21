"use client";
// app/contest/[slug]/ClaimOfferButton.tsx - gets the entrant's personal discount link and opens it.
import { useState } from "react";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";

export default function ClaimOfferButton({ slug, percent }: { slug: string; percent: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/private/contests/${slug}/offer`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setLink(body.data.url as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <Alert tone="danger">{error}</Alert>}
      {link ? (
        <a href={link} className="inline-block rounded-control bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-110">Open my {percent}% off link</a>
      ) : (
        <Button onClick={() => void claim()} loading={busy}>Get my {percent}% off link</Button>
      )}
    </div>
  );
}
