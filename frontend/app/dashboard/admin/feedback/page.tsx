"use client";
// app/dashboard/admin/feedback/page.tsx
// Sprint R1.2 - Phase 1: admin review of real, user-submitted Feedback.
// Sprint D1.0 - Retrofitted onto Card/Badge/Button/Select/Alert + tokens.
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminFeedbackEntry, FeedbackStatus } from "@/services/admin/AdminFeedbackService";
import Card from "@/components/ui/Card";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";

const PAGE_SIZE = 20;
const STATUSES: FeedbackStatus[] = ["open", "reviewed", "resolved"];
const TYPES = ["bug", "feature", "general"];

const TYPE_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  general: "General Feedback",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  open: "warning",
  reviewed: "info",
  resolved: "success",
};

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<AdminFeedbackEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listFeedback({ page, pageSize: PAGE_SIZE, status: status || undefined, type: type || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [page, status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (id: string, next: FeedbackStatus) => {
    setBusyId(id);
    try {
      await AdminApi.updateFeedbackStatus(id, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">Feedback ({total})</h2>
        <div className="flex gap-2">
          <Select
            value={type}
            onChange={(e) => {
              setPage(1);
              setType(e.target.value);
            }}
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
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
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="space-y-3">
        {loading && <Skeleton className="h-40" />}
        {!loading &&
          items.map((f) => (
            <Card key={f.id} padding="sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge>{TYPE_LABELS[f.type] ?? f.type}</Badge>
                  <Badge tone={STATUS_TONE[f.status] ?? "neutral"}>{f.status}</Badge>
                  <span className="text-text-3">{new Date(f.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex gap-2">
                  {STATUSES.filter((s) => s !== f.status).map((s) => (
                    <Button key={s} size="sm" variant="secondary" onClick={() => changeStatus(f.id, s)} disabled={busyId === f.id}>
                      Mark {s}
                    </Button>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-sm text-text">{f.message}</p>
              <p className="mt-2 text-xs text-text-3">
                {f.userName} ({f.userEmail}) {f.page ? `· ${f.page}` : ""}
              </p>
            </Card>
          ))}
        {!loading && items.length === 0 && (
          <p className="rounded-card border border-border bg-ink-2 p-6 text-center text-sm text-text-3">
            No feedback submissions found.
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
