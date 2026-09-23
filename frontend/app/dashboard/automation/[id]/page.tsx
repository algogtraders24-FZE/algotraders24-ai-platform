"use client";

// app/dashboard/automation/[id] - AT24 Automation (MVP) detail.
// LOCKED: AUTOMATION_DECISION_LOCK.md. Pure view over /api/private/
// automations/:id. Lifecycle buttons POST to the server, which owns the
// transition rules; this page just re-fetches and renders the result.
//
// Sprint UI-02.3 - visual-only pass: self min-h-screen/max-w-4xl wrapper
// removed (AppShell provides the content column), lifecycle buttons (Run
// now/Activate/Pause/Resume/Duplicate/Archive) -> Button (loading prop
// replaces the manual "Starting…" text-swap on the busy action), the two
// stat dl blocks -> Card, run-history table -> DataTable, top-level
// loading/error -> LoadingState/ErrorState. Same AutomationApi calls,
// same transition rules (server-owned), same confirm() before archive.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { AutomationDetail, AutomationRunSummary } from "@/types/automation";
import { AutomationApi, AutomationApiError } from "@/services/api/AutomationApi";
import { AutomationStatusPill, RunStatusPill, WorkflowSequence, describeTrigger } from "@/components/automation/ui";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";

export default function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<AutomationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    AutomationApi.get(id)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load automation"));
  }, [id]);

  useEffect(load, [load]);

  async function act(label: string, fn: () => Promise<unknown>, then?: (r: unknown) => void) {
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      if (then) then(r);
      else load();
    } catch (e) {
      setError(e instanceof AutomationApiError ? e.message : e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return <ErrorState title="Could not load automation" description={error} />;
  }
  if (!data) {
    return <LoadingState variant="page" />;
  }

  const a = data;
  const canRun = a.status === "ACTIVE" || a.status === "PAUSED";

  const runColumns: DataTableColumn<AutomationRunSummary>[] = [
    {
      key: "started",
      header: "Started",
      render: (r) => (
        <Link href={`/dashboard/automation/runs/${r.id}`} className="text-text hover:text-gold">
          {r.startedAt ? new Date(r.startedAt).toLocaleString() : "queued"}
        </Link>
      ),
    },
    { key: "status", header: "Status", render: (r) => <RunStatusPill status={r.status} /> },
    { key: "trigger", header: "Trigger", render: (r) => r.trigger },
    { key: "duration", header: "Duration", render: (r) => (r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—") },
    { key: "credits", header: "Credits", align: "right", render: (r) => r.creditsUsed },
  ];

  return (
    <div className="space-y-6">
      <Link href="/dashboard/automation" className="text-sm text-text-3 hover:text-text">
        ← Automations
      </Link>

      <div>
        <p className="text-eyebrow uppercase text-gold">Automation</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-text">{a.name}</h1>
              <AutomationStatusPill status={a.status} />
            </div>
            {a.description && <p className="mt-1 text-sm text-text-3">{a.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canRun && (
              <Button
                loading={busy === "run"}
                onClick={() =>
                  act("run", () => AutomationApi.runNow(a.id), (r) => {
                    const runId = (r as { runId: string }).runId;
                    router.push(`/dashboard/automation/runs/${runId}`);
                  })
                }
              >
                Run now
              </Button>
            )}
            {a.status === "DRAFT" && (
              <Button disabled={!!busy} onClick={() => act("activate", () => AutomationApi.transition(a.id, "activate"))}>
                Activate
              </Button>
            )}
            {a.status === "ACTIVE" && (
              <Button variant="secondary" disabled={!!busy} onClick={() => act("pause", () => AutomationApi.transition(a.id, "pause"))}>
                Pause
              </Button>
            )}
            {a.status === "PAUSED" && (
              <Button variant="secondary" disabled={!!busy} onClick={() => act("resume", () => AutomationApi.transition(a.id, "resume"))}>
                Resume
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={!!busy}
              onClick={() => act("dup", () => AutomationApi.duplicate(a.id), (r) => router.push(`/dashboard/automation/${(r as { id: string }).id}`))}
            >
              Duplicate
            </Button>
            {a.status !== "ARCHIVED" && (
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() => {
                  if (confirm("Archive this automation? It stops running; its run history is kept.")) {
                    act("archive", () => AutomationApi.transition(a.id, "archive"));
                  }
                }}
              >
                Archive
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <dl className="space-y-2 text-sm">
            <Row k="Trigger" v={describeTrigger(a)} />
            <Row k="Timezone" v={a.timezone} />
            <Row k="Active version" v={a.activeVersion ? `v${a.activeVersion}` : "—"} />
            <Row k="Next run" v={a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : "—"} />
            <Row k="Last run" v={a.lastRun ? <RunStatusPill status={a.lastRun.status} /> : "—"} />
            <Row k="Created" v={new Date(a.createdAt).toLocaleDateString()} />
          </dl>
        </Card>
        <Card>
          <dl className="space-y-2 text-sm">
            <Row k="Runs (30d)" v={String(a.stats30d.runs)} />
            <Row k="Succeeded (30d)" v={String(a.stats30d.succeeded)} />
            <Row k="Failed (30d)" v={String(a.stats30d.failed)} />
            <Row k="Credits used (30d)" v={String(a.stats30d.creditsUsed)} />
          </dl>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-title text-text">Steps</h2>
        <Card>
          <WorkflowSequence def={a.definition} />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-title text-text">Run history</h2>
        <DataTable
          columns={runColumns}
          rows={a.recentRuns}
          getRowKey={(r) => r.id}
          empty={{ title: "No runs yet." }}
        />
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-3">{k}</dt>
      <dd className="text-right text-text">{v}</dd>
    </div>
  );
}
