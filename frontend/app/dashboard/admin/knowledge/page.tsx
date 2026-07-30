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
      <h2 className="text-lg font-semibold text-white">Knowledge Documents ({total})</h2>

      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">Total Documents</p>
            <p className="mt-1 text-xl font-semibold text-white">{stats.totalDocuments.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">Total Storage</p>
            <p className="mt-1 text-xl font-semibold text-white">{formatBytes(stats.totalStorageBytes)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">By Status</p>
            <p className="mt-1 text-xs text-slate-400">
              {Object.entries(stats.byStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">By Embedding Status</p>
            <p className="mt-1 text-xs text-slate-400">
              {Object.entries(stats.byEmbeddingStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}
            </p>
          </div>
        </div>
      )}

      {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
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
                <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-4 py-3 text-slate-200">{r.title}</td>
                  <td className="px-4 py-3 text-slate-500">{r.ownerEmail}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {r.status} / {r.embeddingStatus}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{r.chunkCount}</td>
                  <td className="px-4 py-3 text-slate-400">{formatBytes(r.documentSize)}</td>
                  <td className="px-4 py-3 text-slate-400">{r.retrievalCount}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(r.id)}
                      disabled={busyId === r.id}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <div className="h-40 animate-pulse bg-slate-900" />}
        {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-600">No documents found.</p>}
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
