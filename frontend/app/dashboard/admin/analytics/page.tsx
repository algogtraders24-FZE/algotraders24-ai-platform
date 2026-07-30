"use client";
// app/dashboard/admin/analytics/page.tsx
// Sprint L2.6 - Phase 5: AI Usage Analytics, platform-wide. Real totals,
// a real 30-day trend, and real top-users - plus an honest list of what
// isn't tracked yet (never a fabricated number for those).
import { useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminAnalytics } from "@/services/admin/AdminAnalyticsService";

const UNTRACKED_LABELS: Record<string, string> = {
  marketAnalysisRequests: "Market Analysis Requests",
  searchRequests: "Search Requests",
};

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AdminApi.getAnalytics()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load analytics"));
  }, []);

  if (error) return <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>;
  if (!data) return <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />;

  const maxDay = Math.max(1, ...data.assistantMessagesByDay.map((d) => d.count));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Users</p>
          <p className="mt-1 text-xl font-semibold text-white">{data.totals.users.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Conversations</p>
          <p className="mt-1 text-xl font-semibold text-white">{data.totals.conversations.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">AI Messages</p>
          <p className="mt-1 text-xl font-semibold text-white">{data.totals.assistantMessages.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Knowledge Docs</p>
          <p className="mt-1 text-xl font-semibold text-white">{data.totals.knowledgeDocuments.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Storage</p>
          <p className="mt-1 text-xl font-semibold text-white">
            {(data.totals.knowledgeStorageBytes / (1024 * 1024)).toFixed(1)} MB
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="mb-4 text-sm font-semibold text-slate-300">AI Messages - Last 30 Days</h3>
        <div className="flex h-32 items-end gap-1">
          {data.assistantMessagesByDay.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.count}`}
              className="flex-1 rounded-t bg-indigo-500/60"
              style={{ height: `${Math.max(2, (d.count / maxDay) * 100)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="mb-4 text-sm font-semibold text-slate-300">Top Users by AI Messages (30 days)</h3>
        {data.topUsersByAssistantMessages.length === 0 ? (
          <p className="text-sm text-slate-600">No activity in this window.</p>
        ) : (
          <ul className="space-y-2">
            {data.topUsersByAssistantMessages.map((u) => (
              <li key={u.userId} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{u.email}</span>
                <span className="text-slate-500">{u.assistantMessages} messages</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.untracked.length > 0 && (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-400">Not Yet Tracked</h3>
          <p className="text-xs text-slate-600">
            These metrics have no durable record anywhere in the schema today - shown honestly rather than
            estimated.
          </p>
          <ul className="mt-2 text-xs text-slate-500">
            {data.untracked.map((key) => (
              <li key={key}>- {UNTRACKED_LABELS[key] ?? key}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
