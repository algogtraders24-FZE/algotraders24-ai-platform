"use client";

// app/dashboard/automation/runs/[runId] - AT24 Automation (MVP) Run Detail.
// LOCKED: AUTOMATION_DECISION_LOCK.md / AUTOMATION_EXECUTION_CONTRACT.md §10.
// Pure view over /api/private/automation-runs/:id. A non-terminal run is
// advanced by POSTing .../advance in a loop - each call does one bounded
// server-side slice. Failed steps are always shown. "Execution succeeded"
// is never presented as "analysis verified".
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { AutomationRunDetail, AutomationStepRunView } from "@/types/automation";
import { AutomationApi } from "@/services/api/AutomationApi";
import { RunStatusPill } from "@/components/automation/ui";
import { isTerminalAutomationRunStatus } from "@/types/automation";

const MAX_ADVANCES = 60;

export default function AutomationRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<AutomationRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const advancesRef = useRef(0);

  const pump = useCallback(async () => {
    try {
      let current = await AutomationApi.runDetail(runId).then((d) => d.run);
      setRun(current);
      if (isTerminalAutomationRunStatus(current.status)) return;
      setAdvancing(true);
      while (!isTerminalAutomationRunStatus(current.status) && advancesRef.current < MAX_ADVANCES) {
        advancesRef.current += 1;
        const res = await AutomationApi.advanceRun(runId);
        current = res.run;
        setRun(current);
        if (res.terminal || !res.advanced) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setAdvancing(false);
    }
  }, [runId]);

  useEffect(() => {
    void pump();
  }, [pump]);

  if (error && !run) {
    return (
      <div className="min-h-screen bg-ink p-6 text-text">
        <div className="mx-auto max-w-3xl rounded-xl border border-danger/40 bg-danger/10 p-6 text-sm text-danger">{error}</div>
      </div>
    );
  }
  if (!run) return <div className="min-h-screen bg-ink p-6 text-center text-sm text-text-3">Loading…</div>;

  const terminal = isTerminalAutomationRunStatus(run.status);

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link href={`/dashboard/automation/${run.automationId}`} className="text-sm text-text-3 hover:text-text">
          ← {run.automationName}
        </Link>

        <header className="rounded-xl border border-border bg-ink-2 p-5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Run #{run.id.slice(-8)}</h1>
            <RunStatusPill status={run.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <Meta k="Version" v={`v${run.definitionVersion}`} />
            <Meta k="Trigger" v={run.trigger} />
            <Meta k="Started" v={run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "—"} />
            <Meta k="Duration" v={run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : advancing ? "running…" : "—"} />
            <Meta k="Credits" v={String(run.creditsUsed)} />
          </dl>
          {run.error && (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
              <strong>{run.error.code}</strong>: {run.error.message}
              {run.error.failedStepId ? ` (step ${run.error.failedStepId})` : ""}
            </p>
          )}
          {run.status === "SUCCEEDED" && (
            <p className="mt-3 rounded-lg border border-border bg-ink-3 p-2 text-xs text-text-3">
              All steps completed. This confirms the automation ran — it does not verify the analysis. Open the agent run
              for its evidence and confidence.
            </p>
          )}
          {run.status === "CONDITION_HALTED" && (
            <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-2 text-xs text-warn">
              A condition was not met, so the run stopped here. This is a normal outcome, not a failure.
            </p>
          )}
          {!terminal && (
            <p className="mt-3 text-xs text-text-3">{advancing ? "Advancing run…" : "Waiting for the next slice."}</p>
          )}
        </header>

        <ol className="space-y-2">
          {run.steps.map((s) => (
            <StepRow key={s.index} step={s} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepRow({ step }: { step: AutomationStepRunView }) {
  const tone =
    step.status === "OK"
      ? "border-success/30"
      : step.status === "FAILED"
        ? "border-danger/40"
        : step.status === "SKIPPED"
          ? "border-border opacity-60"
          : "border-gold/30";
  const mark = step.status === "OK" ? "✓" : step.status === "FAILED" ? "✕" : step.status === "SKIPPED" ? "–" : "…";
  return (
    <li className={`rounded-lg border bg-ink-2 p-3 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          <span className="mr-2 text-text-3">{mark}</span>
          {step.index + 1}. {step.label}
        </span>
        <span className="text-xs text-text-3">
          {step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : ""}
          {step.creditsUsed ? ` · ${step.creditsUsed} cr` : ""}
        </span>
      </div>

      {step.kind === "condition" && isConditionOutput(step.output) && (
        <p className="mt-1 font-mono text-xs text-text-2">
          {String(step.output.left)} {step.output.op} {String(step.output.right)} → {step.output.result ? "true" : "false"}
          {step.output.note ? ` (${step.output.note})` : ""}
        </p>
      )}
      {step.error && (
        <p className="mt-1 text-xs text-danger">
          {step.error.code}: {step.error.message}
        </p>
      )}
      {step.reason && <p className="mt-1 text-xs text-text-3">{step.reason}</p>}
      {step.agentRunId && (
        <Link
          href={`/dashboard/agents/runs?run=${step.agentRunId}`}
          className="mt-1 inline-block text-xs text-gold hover:underline"
        >
          Open agent run →
        </Link>
      )}
      {step.articleId && <p className="mt-1 text-xs text-text-3">Draft article created ({step.articleId.slice(-8)})</p>}
    </li>
  );
}

function isConditionOutput(v: unknown): v is { left: unknown; op: string; right: unknown; result: boolean; note?: string } {
  return !!v && typeof v === "object" && "result" in v && "op" in v;
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-text-3">{k}</dt>
      <dd className="text-sm text-text">{v}</dd>
    </div>
  );
}
