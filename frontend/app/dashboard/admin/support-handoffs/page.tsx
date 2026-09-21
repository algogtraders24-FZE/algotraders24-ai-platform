"use client";
// app/dashboard/admin/support-handoffs/page.tsx
// AT24 Support Human Handoff MVP - D12. The first internal Support Ticket
// Queue. Mirrors app/dashboard/admin/feedback/page.tsx's own UX pattern
// (Card list + status filter + pagination) - the Feedback TABLE and
// service are never touched, only the pattern is reused.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminQueueEntry } from "@/services/support/handoff-service";
import Card from "@/components/ui/Card";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";

const PAGE_SIZE = 20;
const STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CANCELLED"] as const;

const STATUS_TONE: Record<string, BadgeTone> = {
  OPEN: "warning",
  ASSIGNED: "info",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

export default function AdminSupportHandoffsPage() {
  const [items, setItems] = useState<AdminQueueEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listSupportHandoffs({ page, pageSize: PAGE_SIZE, status: status || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">Support Tickets ({total})</h2>
        <Select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="space-y-3">
        {loading && <Skeleton className="h-40" />}
        {!loading &&
          items.map((h) => (
            <Link key={h.id} href={`/dashboard/admin/support-handoffs/${h.id}`}>
              <Card padding="sm" className="transition hover:border-gold/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone={STATUS_TONE[h.status] ?? "neutral"}>{h.status}</Badge>
                    <Badge>{h.triggerSource === "AI_ESCALATION" ? "AI escalation" : "User requested"}</Badge>
                    <span className="text-text-3">{new Date(h.createdAt).toLocaleString()}</span>
                  </div>
                  {h.assignedAdminUserId && <span className="text-xs text-text-3">Assigned</span>}
                </div>
                <p className="mt-3 text-sm text-text">{h.reason.replace(/-/g, " ")}</p>
                <p className="mt-2 text-xs text-text-3">User: {h.userId}</p>
              </Card>
            </Link>
          ))}
        {!loading && items.length === 0 && (
          <p className="rounded-card border border-border bg-ink-2 p-6 text-center text-sm text-text-3">
            No support tickets found.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-text-3">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
