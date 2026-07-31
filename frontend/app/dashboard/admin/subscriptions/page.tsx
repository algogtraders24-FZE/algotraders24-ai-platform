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
      <h2 className="text-lg font-semibold text-text">Subscriptions ({total})</h2>

      {error && <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-ink-2">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-3">
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
                <tr key={r.userId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="text-text">{r.userName}</div>
                    <div className="text-xs text-text-3">{r.userEmail}</div>
                  </td>
                  <td className="px-4 py-3 text-text-2">{r.planName}</td>
                  <td className="px-4 py-3 text-text-2">{r.status}</td>
                  <td className="px-4 py-3 text-text-3">
                    {r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={r.cancelAtPeriodEnd ? "text-warning" : "text-text-3"}>
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
                        className="rounded-lg border border-border bg-ink px-2 py-1 text-xs text-text-2 disabled:opacity-40"
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
                        className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-2 transition hover:bg-ink-3 disabled:opacity-40"
                      >
                        {r.cancelAtPeriodEnd ? "Reactivate" : "Cancel"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <div className="h-40 animate-pulse bg-ink-2" />}
        {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-text-3">No subscriptions found.</p>}
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
