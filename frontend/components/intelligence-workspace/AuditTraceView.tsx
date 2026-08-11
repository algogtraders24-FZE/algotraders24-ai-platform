"use client";
// components/intelligence-workspace/AuditTraceView.tsx
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. "View analysis trace" - a lightweight, read-only client
// for the existing GET /api/private/intelligence/audit/[traceId] route
// (D2.6.9). Fetched only when the user explicitly asks to see it (never
// eagerly, never duplicated across every message) - authorization is
// enforced server-side (traceId + authenticated userId); this component
// never offers any modify/delete affordance, matching the audit trace's
// own permanent immutability.
import { useEffect, useState } from "react";
import type { IntelligenceAuditTrace } from "@/types/intelligence-audit-trace";
import Badge from "@/components/ui/Badge";
import { formatLabel, formatTimestamp } from "./format";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; trace: IntelligenceAuditTrace };

export default function AuditTraceView({ traceId }: { traceId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/private/intelligence/audit/${encodeURIComponent(traceId)}`);
        const json = (await res.json().catch(() => null)) as { status?: string; data?: { trace?: IntelligenceAuditTrace }; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!res.ok || !json || json.status !== "ok" || !json.data?.trace) {
          setState({ status: "error", message: json?.error?.message ?? "Could not load the analysis trace." });
          return;
        }
        setState({ status: "ready", trace: json.data.trace });
      } catch {
        if (!cancelled) setState({ status: "error", message: "Could not load the analysis trace." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  if (state.status === "loading") {
    return <p className="rounded-card border border-border bg-ink-2 p-4 text-sm text-text-3">Loading analysis trace…</p>;
  }
  if (state.status === "error") {
    return <p className="rounded-card border border-border bg-ink-2 p-4 text-sm text-danger">{state.message}</p>;
  }

  const { trace } = state;

  return (
    <div className="space-y-3 rounded-card border border-border bg-ink-2 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Analysis Trace</p>

      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="uppercase tracking-wider text-text-3">Trace ID</dt>
          <dd className="mt-0.5 font-mono text-text-2">{trace.traceId}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-text-3">Generated</dt>
          <dd className="mt-0.5 text-text-2">{formatTimestamp(trace.createdAt)}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-text-3">Symbol / Timeframe</dt>
          <dd className="mt-0.5 text-text-2">
            {trace.symbol} · {trace.timeframe}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-text-3">Data Provider</dt>
          <dd className="mt-0.5 text-text-2">{trace.marketData.selectedProvider ? formatLabel(trace.marketData.selectedProvider) : "Unavailable"}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-text-3">Fallback</dt>
          <dd className="mt-0.5 text-text-2">{trace.marketData.fallbackUsed ? "Used" : "Not used"}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-text-3">AI Presenter</dt>
          <dd className="mt-0.5 text-text-2">{formatLabel(trace.presenter.selectedProvider)}</dd>
        </div>
      </dl>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-text-3">Presenter Attempts</p>
        <ul className="mt-1.5 space-y-1">
          {trace.presenter.attempts.map((attempt, idx) => (
            <li key={`${attempt.provider}-${attempt.timestamp}-${idx}`} className="flex items-center gap-2 text-xs text-text-2">
              <span className="w-20 shrink-0 text-text-3">{formatLabel(attempt.provider)}</span>
              <Badge tone={attempt.success ? "success" : "neutral"}>{attempt.attempted ? (attempt.success ? "Succeeded" : formatLabel(attempt.failureCategory ?? "failed")) : "Unavailable"}</Badge>
              {attempt.latencyMs !== undefined && <span className="font-mono text-text-3">{attempt.latencyMs}ms</span>}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-text-3">Integrity</p>
        <Badge tone={trace.integrity.valid ? "success" : "warning"}>
          {trace.integrity.valid ? "Passed" : `${trace.integrity.violations.length} violation(s)`}
        </Badge>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-text-3">Intelligence Snapshot</p>
        <p className="mt-1 text-xs text-text-2">
          Decision state: {formatLabel(trace.decisionState)} · Intelligence Score:{" "}
          {trace.envelope.intelligenceScore.overallScore !== undefined ? `${trace.envelope.intelligenceScore.overallScore}/100` : "Unavailable"}
        </p>
      </div>

      <p className="border-t border-border pt-2 text-[11px] text-text-3">
        This trace is immutable and cannot be modified or deleted - it permanently records what the system knew when this answer was generated.
      </p>
    </div>
  );
}
