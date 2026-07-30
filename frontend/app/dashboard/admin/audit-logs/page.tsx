"use client";
// app/dashboard/admin/audit-logs/page.tsx
// Sprint L2.6 - Phase 7: real, paginated, filterable audit log list. Every
// row is a real AuditLog record written by an admin route in this sprint -
// there is no path in the app that fabricates or edits one.
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AuditLogEntry } from "@/services/admin/AuditLogService";

const PAGE_SIZE = 25;
const ACTIONS = [
  "user.role_changed",
  "user.status_changed",
  "subscription.plan_overridden",
  "subscription.canceled",
  "subscription.reactivated",
  "knowledge.deleted",
];

export default function AdminAuditLogsPage() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listAuditLogs({ page, pageSize: PAGE_SIZE, action: action || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [page, action]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Audit Logs ({total})</h2>
        <select
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-300"
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              items.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-800/60 last:border-0 align-top">
                  <td className="px-4 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{entry.actorUserId}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.action}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {entry.targetType}
                    {entry.targetId ? ` · ${entry.targetId}` : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {entry.metadata ? JSON.stringify(entry.metadata) : "-"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <div className="h-40 animate-pulse bg-slate-900" />}
        {!loading && items.length === 0 && <p className="p-6 text-center text-sm text-slate-600">No audit log entries found.</p>}
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
