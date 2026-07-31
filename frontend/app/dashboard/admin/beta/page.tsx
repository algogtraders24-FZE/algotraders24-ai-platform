"use client";
// app/dashboard/admin/beta/page.tsx
// Sprint R1.2 - Phase 4: Admin Beta Overview. Every number comes from
// AdminBetaService (see its header for exactly which table backs each
// stat) - nothing here is a placeholder or illustrative figure.
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminUserSummary } from "@/services/admin/AdminUserService";
import type { BetaOverview, JourneyEvent } from "@/services/admin/AdminBetaService";
import UserJourneyTimeline from "@/components/admin/UserJourneyTimeline";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function AdminBetaPage() {
  const [overview, setOverview] = useState<BetaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [journey, setJourney] = useState<JourneyEvent[] | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);

  useEffect(() => {
    AdminApi.getBetaOverview()
      .then(setOverview)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load beta overview"))
      .finally(() => setLoading(false));
  }, []);

  const search = useCallback(async () => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const result = await AdminApi.listUsers({ page: 1, pageSize: 5, q: query.trim() });
    setResults(result.items);
  }, [query]);

  const selectUser = async (u: AdminUserSummary) => {
    setSelectedUser(u);
    setResults([]);
    setQuery(u.email);
    setJourneyLoading(true);
    try {
      const j = await AdminApi.getUserJourney(u.id);
      setJourney(j);
    } catch {
      setJourney(null);
    } finally {
      setJourneyLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-900" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-slate-900" />
      </div>
    );
  }

  if (error || !overview) {
    return <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error ?? "No data"}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active Beta Users"
          value={overview.activeBetaUsers.count}
          sub={`Logged in within the last ${overview.activeBetaUsers.windowDays} days, of ${overview.totalUsers} total`}
        />
        <StatCard
          label="Completed Onboarding"
          value={`${overview.completedOnboarding.count} (${overview.completedOnboarding.percentOfTotal}%)`}
          sub={overview.completedOnboarding.definition}
        />
        <StatCard label="Feedback Received" value={overview.feedback.total} sub={`${overview.feedback.open} open · ${overview.feedback.reviewed} reviewed · ${overview.feedback.resolved} resolved`} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Most Used Features</h2>
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          {overview.mostUsedFeatures.length === 0 && <p className="text-sm text-slate-600">No events recorded yet.</p>}
          {overview.mostUsedFeatures.map((f) => {
            const max = overview.mostUsedFeatures[0]?.count || 1;
            return (
              <div key={f.type} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-slate-300">{f.label}</span>
                <div className="h-2 flex-1 rounded-full bg-slate-800">
                  <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${(f.count / max) * 100}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right text-slate-500">{f.count}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Drop-off Points</h2>
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          {overview.dropOff.map((stage) => (
            <div key={stage.key} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 text-slate-300">{stage.label}</span>
              <div className="h-2 flex-1 rounded-full bg-slate-800">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${stage.percentOfTotal}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-slate-500">
                {stage.count} ({stage.percentOfTotal}%)
              </span>
            </div>
          ))}
          <p className="pt-2 text-xs text-slate-600">
            &quot;First Login&quot; and &quot;First Analysis&quot; are tracked from this sprint forward only - users who
            reached those milestones earlier won&apos;t be reflected yet.
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">User Journey</h2>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedUser(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Search by name or email..."
              className="w-72 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <button onClick={search} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
              Search
            </button>
          </div>

          {results.length > 0 && (
            <div className="mt-2 space-y-1">
              {results.map((u) => (
                <button
                  key={u.id}
                  onClick={() => selectUser(u)}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800"
                >
                  {u.name} <span className="text-slate-500">({u.email})</span>
                </button>
              ))}
            </div>
          )}

          {selectedUser && (
            <div className="mt-5 border-t border-slate-800 pt-5">
              <p className="mb-4 text-sm text-slate-400">
                Journey for <span className="font-medium text-slate-200">{selectedUser.name}</span> ({selectedUser.email})
              </p>
              {journeyLoading && <div className="h-40 animate-pulse rounded-xl bg-slate-900" />}
              {!journeyLoading && journey && <UserJourneyTimeline journey={journey} />}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
