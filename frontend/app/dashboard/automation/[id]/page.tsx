"use client";

// app/dashboard/automation/[id] - AT24 Automation (MVP) detail.
// LOCKED: AUTOMATION_DECISION_LOCK.md. Pure view over /api/private/
// automations/:id. Lifecycle buttons POST to the server, which owns the
// transition rules; this page just re-fetches and renders the result.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { AutomationDetail } from "@/types/automation";
import { AutomationApi, AutomationApiError } from "@/services/api/AutomationApi";
import { AutomationStatusPill, RunStatusPill, WorkflowSequence, describeTrigger } from "@/components/automation/ui";

const btn = "rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-40";
const btnGold = `${btn} border-gold bg-gold/10 text-gold hover:bg-gold/20`;
const btnGhost = `${btn} border-border text-text-2 hover:bg-ink-3`;

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
    return (
      <div className="min-h-screen bg-ink p-6 text-text">
        <div className="mx-auto max-w-4xl rounded-xl border border-danger/40 bg-danger/10 p-6 text-sm text-danger">{error}</div>
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen bg-ink p-6 text-center text-sm text-text-3">Loading…</div>;
  }

  const a = data;
  const canRun = a.status === "ACTIVE" || a.status === "PAUSED";

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/dashboard/automation" className="text-sm text-text-3 hover:text-text">
            ← Automations
          </Link>
        </div>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{a.name}</h1>
              <AutomationStatusPill status={a.status} />
            </div>
            {a.description && <p className="mt-1 text-sm text-text-3">{a.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canRun && (
              <button
                className={btnGold}
                disabled={!!busy}
                onClick={() =>
                  act("run", () => AutomationApi.runNow(a.id), (r) => {
                    const runId = (r as { runId: string }).runId;
                    router.push(`/dashboard/automation/runs/${runId}`);
                  })
                }
              >
                {busy === "run" ? "Starting…" : "Run now"}
              </button>
            )}
            {a.status === "DRAFT" && (
              <button className={btnGold} disabled={!!busy} onClick={() => act("activate", () => AutomationApi.transition(a.id, "activate"))}>
                Activate
              </button>
            )}
            {a.status === "ACTIVE" && (
              <button className={btnGhost} disabled={!!busy} onClick={() => act("pause", () => AutomationApi.transition(a.id, "pause"))}>
                Pause
              </button>
            )}
            {a.status === "PAUSED" && (
              <button className={btnGhost} disabled={!!busy} onClick={() => act("resume", () => AutomationApi.transition(a.id, "resume"))}>
                Resume
              </button>
            )}
            <button className={btnGhost} disabled={!!busy} onClick={() => act("dup", () => AutomationApi.duplicate(a.id), (r) => router.push(`/dashboard/automation/${(r as { id: string }).id}`))}>
              Duplicate
            </button>
            {a.status !== "ARCHIVED" && (
              <button
                className={btnGhost}
                disabled={!!busy}
                onClick={() => {
                  if (confirm("Archive this automation? It stops running; its run history is kept.")) {
                    act("archive", () => AutomationApi.transition(a.id, "archive"));
                  }
                }}
              >
                Archive
              </button>
            )}
          </div>
        </header>

        {error && <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

        <section className="grid gap-4 sm:grid-cols-2">
          <dl className="space-y-2 rounded-xl border border-border bg-ink-2 p-4 text-sm">
            <Row k="Trigger" v={describeTrigger(a)} />
            <Row k="Timezone" v={a.timezone} />
            <Row k="Active version" v={a.activeVersion ? `v${a.activeVersion}` : "—"} />
            <Row k="Next run" v={a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : "—"} />
            <Row k="Last run" v={a.lastRun ? <RunStatusPill status={a.lastRun.status} /> : "—"} />
            <Row k="Created" v={new Date(a.createdAt).toLocaleDateString()} />
          </dl>
          <dl className="space-y-2 rounded-xl border border-border bg-ink-2 p-4 text-sm">
            <Row k="Runs (30d)" v={String(a.stats30d.runs)} />
            <Row k="Succeeded (30d)" v={String(a.stats30d.succeeded)} />
            <Row k="Failed (30d)" v={String(a.stats30d.failed)} />
            <Row k="Credits used (30d)" v={String(a.stats30d.creditsUsed)} />
          </dl>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-2">Workflow</h2>
          <div className="rounded-xl border border-border bg-ink-2 p-4">
            <WorkflowSequence def={a.definition} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-2">Run history</h2>
          {a.recentRuns.length === 0 ? (
            <p className="rounded-xl border border-border bg-ink-2 p-4 text-sm text-text-3">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-ink-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-text-3">
                    <th className="p-3">Started</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Trigger</th>
                    <th className="p-3">Duration</th>
                    <th className="p-3 text-right">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {a.recentRuns.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-ink-3/50">
                      <td className="p-3">
                        <Link href={`/dashboard/automation/runs/${r.id}`} className="text-text hover:text-gold">
                          {r.startedAt ? new Date(r.startedAt).toLocaleString() : "queued"}
                        </Link>
                      </td>
                      <td className="p-3">
                        <RunStatusPill status={r.status} />
                      </td>
                      <td className="p-3 text-text-2">{r.trigger}</td>
                      <td className="p-3 text-text-2">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                      <td className="p-3 text-right tabular-nums text-text-2">{r.creditsUsed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
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
