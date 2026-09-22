"use client";
// app/dashboard/admin/health/page.tsx
// Sprint L2.6 - Phase 6: System Health Dashboard.
// Sprint L2.7 - Phase 5: now renders the 6 real subsystem checks
// (database, aiProvider, vectorStore, paymentProvider, storage,
// backgroundJobs) from the shared HealthService, via AdminHealthService.
// Every field here is either a real, live check or a real disclosed fact -
// never a fabricated "operational" label for something never actually
// probed.
// Sprint UI-02.5 - visual-only pass onto the UI-01/02.x system: raw
// <button> -> Button, the 3 hand-rolled rounded-2xl boxes -> Card, the
// raw animate-pulse loading div -> LoadingState, the raw error <p> ->
// ErrorState, and each subsystem/overall status label now carries a
// Badge alongside its existing colored text (same real health.status
// strings, no new field). Same AdminApi.getHealth() call, same real
// subsystem/rowCounts data, same refresh behavior.
import { useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminHealthReport } from "@/services/admin/AdminHealthService";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import LoadingState from "@/components/ui/LoadingState";
import ErrorState from "@/components/ui/ErrorState";

const HEALTH_COLORS: Record<string, string> = {
  operational: "text-success",
  degraded: "text-warning",
  down: "text-danger",
  unknown: "text-text-3",
};

const HEALTH_TONE: Record<string, BadgeTone> = {
  operational: "success",
  degraded: "warning",
  down: "danger",
  unknown: "neutral",
};

function healthTone(status: string): BadgeTone {
  return HEALTH_TONE[status] ?? "neutral";
}

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

  if (error) return <ErrorState title="Could not load health report" description={error} action={<Button size="sm" variant="secondary" onClick={load}>Retry</Button>} />;
  if (!report) return <LoadingState variant="page" />;

  const subsystemEntries = Object.entries(report.subsystems).filter(
    ([key]) => key !== "overallHealth" && key !== "timestamp",
  ) as [string, { name: string; health: string; detail: string }][];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2">
          <span className={`text-sm font-semibold uppercase tracking-wide ${HEALTH_COLORS[report.subsystems.overallHealth]}`}>Overall</span>
          <Badge tone={healthTone(report.subsystems.overallHealth)}>{report.subsystems.overallHealth}</Badge>
        </span>
        <Button size="sm" variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      <Card>
        <h3 className="mb-2 text-sm font-semibold text-text-2">Subsystems</h3>
        {subsystemEntries.map(([key, status]) => (
          <Row key={key} label={status.name}>
            <span className="flex flex-col items-end gap-1">
              <Badge tone={healthTone(status.health)}>{status.health}</Badge>
              <span className="text-[11px] font-normal text-text-3">{status.detail}</span>
            </span>
          </Row>
        ))}
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-semibold text-text-2">Configuration</h3>
        <Row label="Repository Mode">{report.repositoryMode}</Row>
        <Row label="Alpha Vantage API Key">
          <Badge tone={report.alphaVantageConfigured ? "success" : "warning"}>
            {report.alphaVantageConfigured ? "Configured" : "Not configured"}
          </Badge>
        </Row>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-semibold text-text-2">Row Counts</h3>
        {Object.entries(report.rowCounts).map(([key, value]) => (
          <Row key={key} label={key}>
            <span className="fin-num">{value.toLocaleString()}</span>
          </Row>
        ))}
      </Card>

      <p className="text-xs text-text-3">Checked at {new Date(report.checkedAt).toLocaleString()}</p>
    </div>
  );
}
