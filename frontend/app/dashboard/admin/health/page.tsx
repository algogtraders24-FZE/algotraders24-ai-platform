"use client";
// app/dashboard/admin/health/page.tsx
// Sprint L2.6 - Phase 6: System Health Dashboard.
// Sprint L2.7 - Phase 5: now renders the 6 real subsystem checks
// (database, aiProvider, vectorStore, paymentProvider, storage,
// backgroundJobs) from the shared HealthService, via AdminHealthService.
// Every field here is either a real, live check or a real disclosed fact -
// never a fabricated "operational" label for something never actually
// probed.
import { useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminHealthReport } from "@/services/admin/AdminHealthService";

const HEALTH_COLORS: Record<string, string> = {
  operational: "text-success",
  degraded: "text-warning",
  down: "text-danger",
  unknown: "text-text-3",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <span className="text-sm text-text-2">{label}</span>
      <span className="text-sm font-medium text-text">{children}</span>
    </div>
  );
}

export default function AdminHealthPage() {
  const [report, setReport] = useState<AdminHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    AdminApi.getHealth()
      .then(setReport)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load health report"));
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</p>;
  if (!report) return <div className="h-64 animate-pulse rounded-2xl border border-border bg-ink-2" />;

  const subsystemEntries = Object.entries(report.subsystems).filter(
    ([key]) => key !== "overallHealth" && key !== "timestamp",
  ) as [string, { name: string; health: string; detail: string }][];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold uppercase tracking-wide ${HEALTH_COLORS[report.subsystems.overallHealth]}`}>
          Overall: {report.subsystems.overallHealth}
        </span>
        <button
          onClick={load}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-2 transition hover:bg-ink-3"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-ink-2 p-5">
        <h3 className="mb-2 text-sm font-semibold text-text-2">Subsystems</h3>
        {subsystemEntries.map(([key, status]) => (
          <Row key={key} label={status.name}>
            <span className="flex flex-col items-end gap-0.5">
              <span className={HEALTH_COLORS[status.health]}>{status.health}</span>
              <span className="text-[11px] font-normal text-text-3">{status.detail}</span>
            </span>
          </Row>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-ink-2 p-5">
        <h3 className="mb-2 text-sm font-semibold text-text-2">Configuration</h3>
        <Row label="Repository Mode">{report.repositoryMode}</Row>
        <Row label="Alpha Vantage API Key">
          <span className={report.alphaVantageConfigured ? "text-success" : "text-warning"}>
            {report.alphaVantageConfigured ? "Configured" : "Not configured"}
          </span>
        </Row>
      </div>

      <div className="rounded-2xl border border-border bg-ink-2 p-5">
        <h3 className="mb-2 text-sm font-semibold text-text-2">Row Counts</h3>
        {Object.entries(report.rowCounts).map(([key, value]) => (
          <Row key={key} label={key}>
            {value.toLocaleString()}
          </Row>
        ))}
      </div>

      <p className="text-xs text-text-3">Checked at {new Date(report.checkedAt).toLocaleString()}</p>
    </div>
  );
}
