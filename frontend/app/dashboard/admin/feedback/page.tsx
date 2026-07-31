"use client";
// app/dashboard/admin/feedback/page.tsx
// Sprint R1.2 - Phase 1: admin review of real, user-submitted Feedback.
// Same paginated/filterable list shape as the Audit Logs page, plus a
// real status transition (open -> reviewed -> resolved).
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminFeedbackEntry, FeedbackStatus } from "@/services/admin/AdminFeedbackService";

const PAGE_SIZE = 20;
const STATUSES: FeedbackStatus[] = ["open", "reviewed", "resolved"];
const TYPES = ["bug", "feature", "general"];

const TYPE_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  general: "General Feedback",
};

const STATUS_COLORS: Record<string, string> = {
  open: "text-amber-400",
  reviewed: "text-sky-400",
  resolved: "text-emerald-400",
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
        <h2 className="text-lg font-semibold text-white">Feedback ({total})</h2>
        <div className="flex gap-2">
          <select
            value={type}
            onChange={(e) => {
              setPage(1);
              setType(e.target.value);
            }}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-300"
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-300"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="space-y-3">
        {!loading &&
          items.map((f) => (
            <div key={f.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 font-medium text-slate-300">
                    {TYPE_LABELS[f.type] ?? f.type}
                  </span>
                  <span className={`font-semibold ${STATUS_COLORS[f.status] ?? "text-slate-400"}`}>{f.status}</span>
                  <span className="text-slate-600">{new Date(f.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex gap-2">
                  {STATUSES.filter((s) => s !== f.status).map((s) => (
                    <button
                      key={s}
                      onClick={() => changeStatus(f.id, s)}
                      disabled={busyId === f.id}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
                    >
                      Mark {s}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-200">{f.message}</p>
              <p className="mt-2 text-xs text-slate-500">
                {f.userName} ({f.userEmail}) {f.page ? `· ${f.page}` : ""}
              </p>
            </div>
          ))}
        {loading && <div className="h-40 animate-pulse rounded-2xl bg-slate-900" />}
        {!loading && items.length === 0 && (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-600">
            No feedback submissions found.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-slate-800 px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-slate-800 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
