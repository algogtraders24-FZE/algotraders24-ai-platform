"use client";
// app/dashboard/agents/runs/page.tsx
// AT24 Agent Framework - A15. The REAL run console for the A1-A14 framework.
//
// Everything here is actual persisted state read back from
// /api/private/agents/framework/*: no simulated progress, no fabricated
// results. A run advances by the client looping POST .../advance until
// { terminal: true } - each request does one bounded server-side tick().
// The legacy /dashboard/agents scaffold is unchanged.
import { useCallback, useEffect, useRef, useState } from "react";

type TypeInfo = {
  type: string;
  label: string;
  description: string;
  defaultTools: string[];
  autonomyCap: number;
  goalHint: string;
};

type TimelineEntry = { index: number; kind: string; status: string; summary: string; durationMs: number };
type ToolCall = { id: string; toolId: string; status: string; createdAt: string };
type Evidence = { id: string; type: string; claim: string; source: string };
type Observability = {
  run: {
    id: string;
    status: string;
    trigger: string;
    creditsConsumed: number;
    errorCode: string | null;
    errorMessage: string | null;
    output: unknown;
    createdAt: string;
    completedAt: string | null;
  } | null;
  steps: { index: number; kind: string; status: string; summary: string }[];
  toolCalls: ToolCall[];
  evidence: Evidence[];
  credits: { entries: { kind: string; amount: number; reason: string }[]; totalCharged: number };
  evaluation: {
    compositeScore: number;
    terminalStatus: string;
    failureCategory: string;
    scores: { dimension: string; score: number; basis: string }[];
  } | null;
  timeline: TimelineEntry[];
};

type ListItem = { runId: string; agentType: string | null; status: string; createdAt: string; creditsConsumed: number; errorCode: string | null };

const TERMINAL = new Set(["succeeded", "failed", "tool_error", "permission_denied", "credit_limit", "step_limit", "timeout", "cancelled"]);
const MAX_ADVANCES = 40;

// Beta content pass - status pills and the error banner were rendering raw
// internal status codes ("tool_error", "credit_limit") and, on a network
// failure or an API response with no error.message, a raw HTTP status line
// ("500 Internal Server Error") or browser exception text directly to the
// user. This maps known statuses to plain language and gives non-product
// failures one honest, generic fallback - never a raw status/exception
// string (same rule components/ui/ErrorState.tsx documents for itself).
const STATUS_LABEL: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  tool_error: "Tool error",
  permission_denied: "Permission denied",
  credit_limit: "Credit limit reached",
  step_limit: "Step limit reached",
  timeout: "Timed out",
  cancelled: "Cancelled",
  running: "Running",
  queued: "Queued",
  pending: "Pending",
};
const GENERIC_ERROR = "Something went wrong. Please try again.";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.status !== "ok") {
    // A real error.message from the API is product-level and safe to show
    // as-is; anything else (raw HTTP status line, or none at all) falls
    // back to the generic message rather than leaking transport details.
    throw new Error(json?.error?.message || GENERIC_ERROR);
  }
  return json.data as T;
}

function friendlyErrorMessage(e: unknown): string {
  if (e instanceof Error && e.message && !/^\d{3}\s/.test(e.message)) return e.message;
  return GENERIC_ERROR;
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "succeeded" ? "border-success/40 bg-success/10 text-success"
      : TERMINAL.has(status) ? "border-danger/40 bg-danger/10 text-danger"
        : "border-gold/40 bg-gold/10 text-gold";
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export default function AgentRunsPage() {
  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [runs, setRuns] = useState<ListItem[]>([]);
  const [agentType, setAgentType] = useState<string>("");
  const [goal, setGoal] = useState<string>("");
  const [obs, setObs] = useState<Observability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const loadList = useCallback(async () => {
    const data = await api<{ runs: ListItem[]; types: TypeInfo[] }>("/api/private/agents/framework/runs");
    setRuns(data.runs);
    setTypes(data.types);
    setAgentType((t) => t || data.types[0]?.type || "");
  }, []);

  useEffect(() => {
    loadList().catch((e) => setError(friendlyErrorMessage(e)));
  }, [loadList]);

  const driveToTerminal = useCallback(async (runId: string) => {
    runningRef.current = true;
    try {
      for (let i = 0; i < MAX_ADVANCES; i++) {
        const data = await api<{ run: Observability; terminal: boolean }>(
          `/api/private/agents/framework/runs/${runId}/advance`,
          { method: "POST" },
        );
        setObs(data.run);
        if (data.terminal || TERMINAL.has(data.run.run?.status ?? "")) break;
      }
    } finally {
      runningRef.current = false;
      await loadList().catch(() => {});
    }
  }, [loadList]);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    setObs(null);
    try {
      let parsedGoal: unknown = goal.trim();
      if (goal.trim().startsWith("{")) {
        try { parsedGoal = JSON.parse(goal); } catch { throw new Error("goal looks like JSON but does not parse"); }
      }
      const { runId } = await api<{ runId: string }>("/api/private/agents/framework/runs", {
        method: "POST",
        body: JSON.stringify({ agentType, goal: parsedGoal }),
      });
      const first = await api<{ run: Observability }>(`/api/private/agents/framework/runs/${runId}`);
      setObs(first.run);
      await driveToTerminal(runId);
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [agentType, goal, driveToTerminal]);

  const openRun = useCallback(async (runId: string) => {
    setError(null);
    try {
      const data = await api<{ run: Observability }>(`/api/private/agents/framework/runs/${runId}`);
      setObs(data.run);
      if (!TERMINAL.has(data.run.run?.status ?? "")) await driveToTerminal(runId);
    } catch (e) {
      setError(friendlyErrorMessage(e));
    }
  }, [driveToTerminal]);

  const selectedType = types.find((t) => t.type === agentType);

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl border border-border bg-gradient-to-r from-gold/20 to-gold/10 p-6">
          <h1 className="text-2xl font-bold">AI Agents</h1>
          <p className="mt-1 text-sm text-text-2">
            Start a focused agent on a task and watch it work in real time - every plan step, tool call, and
            piece of evidence below is the agent&apos;s actual run, never a simulated preview.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</div>
        )}

        {/* start */}
        <section className="rounded-2xl border border-border bg-ink-2 p-5">
          <h2 className="mb-3 text-sm font-semibold text-text-2">Start a run</h2>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {types.map((t) => (
                <button
                  key={t.type}
                  onClick={() => setAgentType(t.type)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    t.type === agentType ? "border-gold bg-gold/10 text-gold" : "border-border text-text-2 hover:bg-ink-3"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {selectedType && (
              <p className="text-xs text-text-3">
                {selectedType.description} · tools: {selectedType.defaultTools.join(", ")} · autonomy cap {selectedType.autonomyCap}
              </p>
            )}
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              placeholder={selectedType?.goalHint ?? "goal (string or JSON object)"}
              className="w-full rounded-lg border border-border bg-ink px-3 py-2 font-mono text-xs text-text outline-none focus:border-gold"
            />
            <button
              onClick={start}
              disabled={busy || !agentType}
              className="rounded-lg border border-gold bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition hover:bg-gold/20 disabled:opacity-40"
            >
              {busy ? "Running…" : "Start run"}
            </button>
          </div>
        </section>

        {/* live observability */}
        {obs?.run && (
          <section className="rounded-2xl border border-border bg-ink-2 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-2">
                Run <span className="font-mono text-xs text-text-3">{obs.run.id}</span>
              </h2>
              <StatusPill status={obs.run.status} />
            </div>

            {obs.run.errorCode && (
              <p className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
                {obs.run.errorCode}: {obs.run.errorMessage}
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-text-3">Timeline</h3>
                <ol className="space-y-1 text-xs">
                  {obs.timeline.map((s) => (
                    <li key={s.index} className="flex items-center gap-2">
                      <span className="w-4 text-right text-text-3">{s.index}</span>
                      <span className={s.status === "ok" ? "text-text-2" : "text-danger"}>{s.kind}</span>
                      <span className="truncate text-text-3">{s.summary}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-text-3">Tool calls</h3>
                <ul className="space-y-1 text-xs">
                  {obs.toolCalls.map((tc) => (
                    <li key={tc.id} className="flex gap-2">
                      <span className="font-mono text-text-2">{tc.toolId}</span>
                      <span className={tc.status === "ok" ? "text-text-3" : "text-danger"}>{tc.status}</span>
                    </li>
                  ))}
                  {obs.toolCalls.length === 0 && <li className="text-text-3">No tool calls yet.</li>}
                </ul>
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold text-text-3">Evidence ({obs.evidence.length})</h3>
              <ul className="space-y-1 text-xs">
                {obs.evidence.slice(0, 8).map((e) => (
                  <li key={e.id} className="text-text-3">
                    <span className="text-text-2">[{e.type}]</span> {e.claim} <span className="text-text-3">— {e.source}</span>
                  </li>
                ))}
              </ul>
            </div>

            {obs.evaluation && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-text-3">
                  Evaluation · composite {obs.evaluation.compositeScore.toFixed(2)} · {obs.evaluation.failureCategory}
                </h3>
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {obs.evaluation.scores.map((s) => (
                    <span key={s.dimension} className="rounded border border-border px-1.5 py-0.5 text-text-3" title={s.basis}>
                      {s.dimension} {s.score.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-text-3">
              <span>Credits charged: {obs.credits.totalCharged}</span>
              <span>Total credits used: {obs.run.creditsConsumed}</span>
            </div>

            {obs.run.output != null && (
              <details className="text-xs">
                <summary className="cursor-pointer text-text-2">Output</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-ink p-3 text-[11px] text-text-3">
                  {JSON.stringify(obs.run.output, null, 2)}
                </pre>
              </details>
            )}
          </section>
        )}

        {/* history */}
        <section className="rounded-2xl border border-border bg-ink-2 p-5">
          <h2 className="mb-3 text-sm font-semibold text-text-2">Your runs</h2>
          <ul className="divide-y divide-border text-xs">
            {runs.map((r) => (
              <li key={r.runId}>
                <button onClick={() => openRun(r.runId)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-ink-3">
                  <span className="font-mono text-text-3">{r.runId.slice(0, 10)}</span>
                  <span className="text-text-2">{r.agentType ?? "—"}</span>
                  <StatusPill status={r.status} />
                  <span className="text-text-3">{r.creditsConsumed} cr</span>
                  <span className="text-text-3">{new Date(r.createdAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
            {runs.length === 0 && <li className="py-2 text-text-3">No runs yet - start one above to see it here.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
