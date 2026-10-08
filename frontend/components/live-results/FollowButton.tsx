"use client";
// components/live-results/FollowButton.tsx
// "Watch" a public Live Results page: it then shows up in the member's dashboard (Live Results -> Watching)
// and updates by itself. Visitors who are not signed in are sent to the login page.
import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";

export default function FollowButton({ slug, signedIn, initialFollowing, size = "md", onChange }: { slug: string; signedIn: boolean; initialFollowing: boolean; size?: "sm" | "md"; onChange?: () => void }) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <Link href="/login" className="inline-flex items-center rounded-control border border-border px-3 py-1.5 text-sm font-medium text-text-2 hover:border-gold/40 hover:text-text">
        Sign in to watch
      </Link>
    );
  }

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      const r = following
        ? await fetch(`/api/private/live-results/follow?slug=${encodeURIComponent(slug)}`, { method: "DELETE" })
        : await fetch("/api/private/live-results/follow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error?.message ?? "Could not update");
      setFollowing(!following);
      onChange?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size={size} variant={following ? "secondary" : "primary"} onClick={() => void toggle()} loading={busy}>
        {following ? "✓ Watching" : "Watch this page"}
      </Button>
      {following && <Link href="/dashboard/live-results" className="text-xs font-semibold text-gold hover:underline">See it in your dashboard</Link>}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}
