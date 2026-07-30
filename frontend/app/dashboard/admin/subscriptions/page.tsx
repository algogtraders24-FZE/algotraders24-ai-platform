"use client";
// app/dashboard/admin/subscriptions/page.tsx
// Sprint L2.6 - Phase 3: Subscription Management (admin view). Real,
// paginated list joining User+Subscription+Plan, with real
// cancel/reactivate/override-plan actions (all audit-logged
// server-side). Independent of the L2.5 user-facing Billing module.
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminSubscriptionRow } from "@/services/admin/AdminSubscriptionService";

const PAGE_SIZE = 20;
const PLAN_IDS = ["free", "pro", "elite", "enterprise"];

export default function AdminSubscriptionsPage() {
  const [rows, setRows] = useState<AdminSubscriptionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listSubscriptions({ page, pageSize: PAGE_SIZE });
      setRows(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (userId: string, fn: () => Promise<unknown>) => {
    setBusyId(userId);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Subscriptions ({total})</h2>

      {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Period End</th>
              <th className="px-4 py-3 font-medium">Cancel at period end</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              rows.map((r) => (
                <tr key={r.userId} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="text-slate-200">{r.userName}</div>
                    <div className="text-xs text-slate-500">{r.userEmail}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{r.planName}</td>
                  <td className="px-4 py-3 text-slate-400">{r.status}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={r.cancelAtPeriodEnd ? "text-amber-400" : "text-slate-600"}>
                      {r.cancelAtPeriodEnd ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <select
                        disabled={busyId === r.userId}
                        defaultValue=""
                        onChange={(e) => {
                          const planId = e.target.value;
                          e.target.value = "";
                          if (planId) run(r.userId, () => AdminApi.overridePlan(r.userId, planId));
                        }}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 disabled:opacity-40"
                      >
                        <option value="" disabled>
                          Override plan...
                        </option>
                        {PLAN_IDS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          run(r.userId, () =>
                            r.cancelAtPeriodEnd
                              ? AdminApi.reactivateSubscription(r.userId)
                              : AdminApi.cancelSubscription(r.userId),
                          )
                        }
                        disabled={busyId === r.userId || !r.subscriptionId}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
                      >
                        {r.cancelAtPeriodEnd ? "Reactivate" : "Cancel"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <div className="h-40 animate-pulse bg-slate-900" />}
        {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-600">No subscriptions found.</p>}
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
