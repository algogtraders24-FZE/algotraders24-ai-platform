"use client";
// app/dashboard/admin/listing-reports/page.tsx
// Seller self-serve Phase 5 - buyer reports and auto-suspended listings. The only decision here: restore or retire.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import { REPORT_REASONS } from "@/lib/marketplace/reports";

interface Report { id: string; reason: string; details: string; createdAt: string }
interface Group { listingId: string; title: string; slug: string; publicationState: string; sellerEmail: string | null; openCount: number; reports: Report[] }

const reasonLabel = (k: string) => REPORT_REASONS.find((r) => r.key === k)?.label ?? k;

export default function AdminListingReportsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/private/admin/listing-reports", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== "ok") { setError(body?.error?.message ?? `Request failed (${res.status})`); return; }
    setGroups(body.data.groups as Group[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(listingId: string, action: "restore" | "retire") {
    const sure = action === "retire" ? window.confirm("Retire this listing? It is removed from sale and every build is revoked (buyers' licences stop validating).") : window.confirm("Put this listing back on sale and dismiss the reports?");
    if (!sure) return;
    setBusyId(listingId);
    setError(null);
    try {
      const res = await fetch("/api/private/admin/listing-reports", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, action }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="ADMIN" title="Listing reports" description="Buyers who paid for a product can report it. Three different buyers suspend the listing automatically; you decide whether to restore or retire it." />
      {error && <Alert tone="danger">{error}</Alert>}
      <Card className="space-y-3 p-5">
        {groups === null ? (
          <p className="text-sm text-text-3">Loading...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-text-3">No open reports and nothing suspended.</p>
        ) : (
          groups.map((g) => (
            <div key={g.listingId} className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/marketplace/${g.slug}`} className="font-semibold text-gold hover:underline">{g.title}</Link>
                <Badge tone={g.publicationState === "SUSPENDED" ? "danger" : "neutral"}>{g.publicationState.toLowerCase()}</Badge>
                <span className="text-text-2">{g.openCount} open report{g.openCount === 1 ? "" : "s"}</span>
                <span className="text-xs text-text-3">seller: {g.sellerEmail ?? "unknown"}</span>
              </div>
              <ul className="space-y-1">
                {g.reports.map((r) => (
                  <li key={r.id} className="rounded-md bg-ink-3 p-2">
                    <span className="font-medium text-text">{reasonLabel(r.reason)}</span> <span className="text-xs text-text-3">{r.createdAt.slice(0, 10)}</span>
                    <p className="whitespace-pre-line text-text-2">{r.details}</p>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void act(g.listingId, "restore")} loading={busyId === g.listingId} variant="secondary">Restore (dismiss reports)</Button>
                <Button onClick={() => void act(g.listingId, "retire")} disabled={busyId === g.listingId} variant="danger">Retire (remove + revoke builds)</Button>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
