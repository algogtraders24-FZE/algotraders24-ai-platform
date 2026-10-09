"use client";
// components/marketplace/ReportListingPanel.tsx
// "Report this listing" for buyers. Renders nothing unless the signed-in user has paid for this listing (the server decides).
import { useEffect, useState } from "react";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { REPORT_REASONS, MAX_DETAILS_CHARS } from "@/lib/marketplace/reports";

export default function ReportListingPanel({ listingId }: { listingId: string }) {
  const [state, setState] = useState<"hidden" | "closed" | "open" | "done">("hidden");
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].key);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/private/marketplace/listings/${listingId}/abuse-report`, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!alive || !res.ok || body?.status !== "ok") return;
        if (body.data.alreadyReported) setState("done");
        else if (body.data.canReport) setState("closed");
      } catch {
        /* stays hidden */
      }
    })();
    return () => { alive = false; };
  }, [listingId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/private/marketplace/listings/${listingId}/abuse-report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, details }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the report.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "hidden") return null;
  return (
    <section className="mx-auto max-w-6xl px-6 pb-12">
      <div className="rounded-xl border border-border bg-ink-2 p-5">
        {state === "done" ? (
          <p className="text-sm text-text-2">Thank you. Your report about this listing was received and is being reviewed.</p>
        ) : state === "closed" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-2">Something wrong with this product? Because you bought it, you can report it.</p>
            <Button variant="secondary" onClick={() => setState("open")}>Report this listing</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-lg font-semibold text-text">Report this listing</h2>
            <Select value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} className="w-full">
              {REPORT_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
            <Textarea rows={4} value={details} maxLength={MAX_DETAILS_CHARS} onChange={(e) => setDetails(e.target.value)} disabled={busy} placeholder="What exactly happened? (at least 10 characters)" />
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>Send report</Button>
              <Button type="button" variant="ghost" onClick={() => setState("closed")} disabled={busy}>Cancel</Button>
            </div>
            <p className="text-xs text-text-3">Reports are reviewed by AT24. A listing that several buyers report is hidden automatically while we check it. Please report honestly.</p>
          </form>
        )}
      </div>
    </section>
  );
}
