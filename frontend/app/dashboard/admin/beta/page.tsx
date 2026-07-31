"use client";
// app/dashboard/admin/beta/page.tsx
// Sprint R1.2 - Phase 4: Admin Beta Overview. Every number comes from
// AdminBetaService - nothing here is a placeholder or illustrative figure.
// Sprint D1.0 - Retrofitted onto Card/Input/Button/Alert/Skeleton + tokens
// (slate chrome -> ink/border/text; indigo/emerald progress bars -> gold/
// success).
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminUserSummary } from "@/services/admin/AdminUserService";
import type { BetaOverview, JourneyEvent } from "@/services/admin/AdminBetaService";
import UserJourneyTimeline from "@/components/admin/UserJourneyTimeline";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card padding="sm" className="p-5">
      <p className="text-xs uppercase tracking-wider text-text-3">{label}</p>
      <p className="mt-2 text-2xl font-bold text-text">{value}</p>
      {sub && <p className="mt-1 text-xs text-text-3">{sub}</p>}
    </Card>
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
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !overview) {
    return <Alert tone="danger">{error ?? "No data"}</Alert>;
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
        <h2 className="mb-3 text-lg font-semibold text-text">Most Used Features</h2>
        <Card padding="sm" className="space-y-2 p-5">
          {overview.mostUsedFeatures.length === 0 && <p className="text-sm text-text-3">No events recorded yet.</p>}
          {overview.mostUsedFeatures.map((f) => {
            const max = overview.mostUsedFeatures[0]?.count || 1;
            return (
              <div key={f.type} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-text-2">{f.label}</span>
                <div className="h-2 flex-1 rounded-full bg-ink-3">
                  <div className="h-2 rounded-full bg-gold" style={{ width: `${(f.count / max) * 100}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right text-text-3">{f.count}</span>
              </div>
            );
          })}
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Drop-off Points</h2>
        <Card padding="sm" className="space-y-3 p-5">
          {overview.dropOff.map((stage) => (
            <div key={stage.key} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 text-text-2">{stage.label}</span>
              <div className="h-2 flex-1 rounded-full bg-ink-3">
                <div className="h-2 rounded-full bg-success" style={{ width: `${stage.percentOfTotal}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-text-3">
                {stage.count} ({stage.percentOfTotal}%)
              </span>
            </div>
          ))}
          <p className="pt-2 text-xs text-text-3">
            &quot;First Login&quot; and &quot;First Analysis&quot; are tracked from this sprint forward only - users who
            reached those milestones earlier won&apos;t be reflected yet.
          </p>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">User Journey</h2>
        <Card padding="sm" className="p-5">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedUser(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Search by name or email..."
              className="w-72"
            />
            <Button variant="secondary" onClick={search}>
              Search
            </Button>
          </div>

          {results.length > 0 && (
            <div className="mt-2 space-y-1">
              {results.map((u) => (
                <button
                  key={u.id}
                  onClick={() => selectUser(u)}
                  className="block w-full rounded-control px-3 py-2 text-left text-sm text-text-2 transition hover:bg-ink-3"
                >
                  {u.name} <span className="text-text-3">({u.email})</span>
                </button>
              ))}
            </div>
          )}

          {selectedUser && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="mb-4 text-sm text-text-2">
                Journey for <span className="font-medium text-text">{selectedUser.name}</span> ({selectedUser.email})
              </p>
              {journeyLoading && <Skeleton className="h-40" />}
              {!journeyLoading && journey && <UserJourneyTimeline journey={journey} />}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
