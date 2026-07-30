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
  operational: "text-emerald-400",
  degraded: "text-amber-400",
  down: "text-red-400",
  unknown: "text-slate-500",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 py-3 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-200">{children}</span>
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

  if (error) return <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>;
  if (!report) return <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />;

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
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Subsystems</h3>
        {subsystemEntries.map(([key, status]) => (
          <Row key={key} label={status.name}>
            <span className="flex flex-col items-end gap-0.5">
              <span className={HEALTH_COLORS[status.health]}>{status.health}</span>
              <span className="text-[11px] font-normal text-slate-600">{status.detail}</span>
            </span>
          </Row>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Configuration</h3>
        <Row label="Repository Mode">{report.repositoryMode}</Row>
        <Row label="Alpha Vantage API Key">
          <span className={report.alphaVantageConfigured ? "text-emerald-400" : "text-amber-400"}>
            {report.alphaVantageConfigured ? "Configured" : "Not configured"}
          </span>
        </Row>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Row Counts</h3>
        {Object.entries(report.rowCounts).map(([key, value]) => (
          <Row key={key} label={key}>
            {value.toLocaleString()}
          </Row>
        ))}
      </div>

      <p className="text-xs text-slate-600">Checked at {new Date(report.checkedAt).toLocaleString()}</p>
    </div>
  );
}
