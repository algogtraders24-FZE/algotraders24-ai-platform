"use client";
// app/dashboard/admin/health/page.tsx
// Sprint L2.6 - Phase 6: System Health Dashboard. Every field here is a
// real, live check or a real disclosed fact - never a fabricated
// "operational" label (see AdminHealthService and the L2.6 audit's finding
// that /api/system/status fabricates 5 of its 6 subsystem checks).
import { useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminHealthReport } from "@/services/admin/AdminHealthService";

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

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={load}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Database</h3>
        <Row label="Reachable">
          <span className={report.database.reachable ? "text-emerald-400" : "text-red-400"}>
            {report.database.reachable ? "Yes" : "No"}
          </span>
        </Row>
        <Row label="Repository Mode">{report.database.repositoryMode}</Row>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">AI Providers (configuration presence)</h3>
        <Row label="Gemini API Key">
          <span className={report.providers.geminiConfigured ? "text-emerald-400" : "text-amber-400"}>
            {report.providers.geminiConfigured ? "Configured" : "Not configured"}
          </span>
        </Row>
        <Row label="Alpha Vantage API Key">
          <span className={report.providers.alphaVantageConfigured ? "text-emerald-400" : "text-amber-400"}>
            {report.providers.alphaVantageConfigured ? "Configured" : "Not configured"}
          </span>
        </Row>
        <p className="mt-2 text-xs text-slate-600">
          This reports whether a key is present, not whether the provider is currently responding correctly.
        </p>
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
