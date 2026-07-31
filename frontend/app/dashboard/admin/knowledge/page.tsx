"use client";
// app/dashboard/admin/knowledge/page.tsx
// Sprint L2.6 - Phase 4: Knowledge Administration. Real, paginated list of
// Knowledge documents across all users, real aggregate stats, and a real,
// audit-logged soft-delete moderation action.
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminKnowledgeRow, AdminKnowledgeStats } from "@/services/admin/AdminKnowledgeService";

const PAGE_SIZE = 20;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function AdminKnowledgePage() {
  const [rows, setRows] = useState<AdminKnowledgeRow[]>([]);
  const [stats, setStats] = useState<AdminKnowledgeStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listKnowledge({ page, pageSize: PAGE_SIZE });
      setRows(result.items);
      setTotal(result.total);
      setStats(result.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge documents");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this document? This soft-deletes it (recoverable via the database), and is audit-logged.")) return;
    setBusyId(id);
    setError(null);
    try {
      await AdminApi.deleteKnowledge(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text">Knowledge Documents ({total})</h2>

      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-border bg-ink-2 p-4">
            <p className="text-xs uppercase tracking-wider text-text-3">Total Documents</p>
            <p className="mt-1 text-xl font-semibold text-text">{stats.totalDocuments.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-border bg-ink-2 p-4">
            <p className="text-xs uppercase tracking-wider text-text-3">Total Storage</p>
            <p className="mt-1 text-xl font-semibold text-text">{formatBytes(stats.totalStorageBytes)}</p>
          </div>
          <div className="rounded-2xl border border-border bg-ink-2 p-4">
            <p className="text-xs uppercase tracking-wider text-text-3">By Status</p>
            <p className="mt-1 text-xs text-text-2">
              {Object.entries(stats.byStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-ink-2 p-4">
            <p className="text-xs uppercase tracking-wider text-text-3">By Embedding Status</p>
            <p className="mt-1 text-xs text-text-2">
              {Object.entries(stats.byEmbeddingStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}
            </p>
          </div>
        </div>
      )}

      {error && <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-ink-2">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-3">
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Chunks</th>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 font-medium">Retrievals</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-text">{r.title}</td>
                  <td className="px-4 py-3 text-text-3">{r.ownerEmail}</td>
                  <td className="px-4 py-3 text-text-2">
                    {r.status} / {r.embeddingStatus}
                  </td>
                  <td className="px-4 py-3 text-text-2">{r.chunkCount}</td>
                  <td className="px-4 py-3 text-text-2">{formatBytes(r.documentSize)}</td>
                  <td className="px-4 py-3 text-text-2">{r.retrievalCount}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(r.id)}
                      disabled={busyId === r.id}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-2 transition hover:border-danger/40 hover:text-danger disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <div className="h-40 animate-pulse bg-ink-2" />}
        {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-text-3">No documents found.</p>}
      </div>

      <div className="flex items-center justify-between text-sm text-text-3">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
