"use client";
// components/license/RevealApiKeyButton.tsx
// Sprint M13 (closing the marketplace delivery loop) - calls the real
// POST /api/private/licenses/[licenseId]/reveal-key endpoint. The raw key
// is shown exactly once (see licenseService.ts's regenerateApiKey) - never
// persisted client-side beyond this component's own state, never logged.
import { useState } from "react";
import Alert from "@/components/ui/Alert";

export default function RevealApiKeyButton({ licenseId }: { licenseId: string }) {
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReveal = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/private/licenses/${licenseId}/reveal-key`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.status !== "ok") {
        throw new Error(body?.error?.message ?? "Could not generate an API key");
      }
      setRawKey(body.data.rawApiKey as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate an API key");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
    } catch {
      // Clipboard access can fail (permissions/insecure context) - the key
      // text is still visible and selectable, so this is a non-fatal miss.
    }
  };

  if (rawKey) {
    return (
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">Your AT24 API Key</p>
        <p className="mt-1 text-xs text-text-3">Save this now - paste it into the EA&apos;s InpApiKey input. It will not be shown again; regenerating replaces it.</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-ink px-3 py-2 text-xs text-text">{rawKey}</code>
          <button onClick={handleCopy} className="shrink-0 rounded-control border border-border px-3 py-2 text-xs font-semibold text-text-2 transition hover:border-gold hover:text-gold">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <Alert tone="danger">{error}</Alert>}
      <button
        onClick={handleReveal}
        disabled={loading}
        className="rounded-control bg-gold px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-60"
      >
        {loading ? "Generating..." : "Reveal / Regenerate API Key"}
      </button>
    </div>
  );
}
