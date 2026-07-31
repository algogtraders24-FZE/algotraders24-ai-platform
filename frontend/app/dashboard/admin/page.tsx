"use client";
// app/dashboard/admin/page.tsx
// Sprint L2.6 - Admin overview: a real snapshot pulled from the same
// health/analytics endpoints the dedicated pages use, plus quick links.
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminHealthReport } from "@/services/admin/AdminHealthService";
import type { AdminAnalytics } from "@/services/admin/AdminAnalyticsService";

function Card({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-ink-2 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-text-3">{label}</p>
      <div className="mt-2 text-2xl font-semibold text-text" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const [health, setHealth] = useState<AdminHealthReport | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([AdminApi.getHealth(), AdminApi.getAnalytics()])
      .then(([h, a]) => {
        setHealth(h);
        setAnalytics(a);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load admin overview"));
  }, []);

  if (error) {
    return <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</p>;
  }

  if (!health || !analytics) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-ink-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card
          label="Database"
          value={health.subsystems.database.health === "operational" ? "Reachable" : "Unreachable"}
          accent={health.subsystems.database.health === "operational" ? "#34d399" : "#f87171"}
        />
        <Card label="Total Users" value={analytics.totals.users.toLocaleString()} />
        <Card label="Conversations" value={analytics.totals.conversations.toLocaleString()} />
        <Card label="Knowledge Documents" value={analytics.totals.knowledgeDocuments.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "User Management", href: "/dashboard/admin/users", desc: "View and manage all platform users" },
          { label: "Subscription Management", href: "/dashboard/admin/subscriptions", desc: "Review and override subscriptions" },
          { label: "Knowledge Administration", href: "/dashboard/admin/knowledge", desc: "Moderate uploaded documents" },
          { label: "AI Usage Analytics", href: "/dashboard/admin/analytics", desc: "Platform-wide usage trends" },
          { label: "System Health", href: "/dashboard/admin/health", desc: "Real database & provider status" },
          { label: "Audit Logs", href: "/dashboard/admin/audit-logs", desc: "Every admin action, traceable" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-xl border border-border bg-ink-2 p-4 transition hover:border-gold/40 hover:bg-ink-2"
          >
            <p className="font-semibold text-text">{link.label}</p>
            <p className="mt-1 text-xs text-text-3">{link.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
