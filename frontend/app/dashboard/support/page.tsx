"use client";
// app/dashboard/support/page.tsx
// AT24 Agent Framework - CS1. The Chat Support Assistant console.
//
// A focused, single-purpose surface: ask a support question -> the SUPPORT
// agent runs on the real A1-A15 framework runtime -> the answer is rendered
// from actual persisted state (cited support passages + account-status
// findings + the escalation hand-off). No simulated progress, no fabricated
// answer text.
//
// LOCKED (CS1.2 D1): strictly separate from the main AI Assistant. This page
// talks ONLY to /api/private/agents/framework/* with agentType "SUPPORT" - it
// never touches services/ai/*, the knowledge chat route, or the Conversation
// stack. It does not import the trading "AI Agents" run console either.
import { useCallback, useState } from "react";

type Evidence = { id: string; type: string; claim: string; source: string };
type SupportOutput = {
  kind?: string;
  resolved?: boolean;
  coverage?: "kb-answered" | "account-context" | "no-coverage";
  citationCount?: number;
  topics?: string[];
  citations?: { evidenceId: string; topic: string; source: string; relevance: number }[];
  accountFindings?: { evidenceId: string; domain: string }[];
  escalate?: boolean;
  escalationReason?: string | null;
  disclaimer?: string;
};
type Observability = {
  run: { id: string; status: string; errorCode: string | null; errorMessage: string | null; output: unknown } | null;
  evidence: Evidence[];
  timeline: { index: number; kind: string; status: string; summary: string }[];
};

const TERMINAL = new Set(["succeeded", "failed", "tool_error", "permission_denied", "credit_limit", "step_limit", "timeout", "cancelled"]);
const MAX_ADVANCES = 12;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.status !== "ok") {
    throw new Error(json?.error?.message ?? `${res.status} ${res.statusText}`);
  }
  return json.data as T;
}

export default function SupportAssistantPage() {
  const [question, setQuestion] = useState("");
  const [obs, setObs] = useState<Observability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    setError(null);
    setBusy(true);
    setObs(null);
    try {
      const { runId } = await api<{ runId: string }>("/api/private/agents/framework/runs", {
        method: "POST",
        body: JSON.stringify({ agentType: "SUPPORT", goal: { question: q } }),
      });
      const first = await api<{ run: Observability }>(`/api/private/agents/framework/runs/${runId}`);
      setObs(first.run);
      for (let i = 0; i < MAX_ADVANCES; i++) {
        const data = await api<{ run: Observability; terminal: boolean }>(
          `/api/private/agents/framework/runs/${runId}/advance`,
          { method: "POST" },
        );
        setObs(data.run);
        if (data.terminal || TERMINAL.has(data.run.run?.status ?? "")) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [question]);

  const out = (obs?.run?.output ?? null) as SupportOutput | null;
  const evById = new Map((obs?.evidence ?? []).map((e) => [e.id, e]));
  const citedPassages = (out?.citations ?? [])
    .map((c) => ({ ...c, evidence: evById.get(c.evidenceId) }))
    .filter((c) => c.evidence);
  const accountFacts = (out?.accountFindings ?? [])
    .map((f) => ({ ...f, evidence: evById.get(f.evidenceId) }))
    .filter((f) => f.evidence);

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-2xl border border-border bg-gradient-to-r from-gold/20 to-gold/10 p-6">
          <h1 className="text-2xl font-bold">Support Assistant</h1>
          <p className="mt-1 text-sm text-text-2">
            Answers from AT24&rsquo;s own support knowledge base and the read-only status of your own
            account. It cannot change your account, billing, credits or licenses &mdash; when it can&rsquo;t
            resolve a question it hands off to a human. Separate from the main AI Assistant.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</div>
        )}

        <section className="rounded-2xl border border-border bg-ink-2 p-5 space-y-3">
          <label htmlFor="support-q" className="text-sm font-semibold text-text-2">Your question</label>
          <textarea
            id="support-q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="e.g. How do I upgrade my plan, and what is my subscription status?"
            className="w-full rounded-lg border border-border bg-ink px-3 py-2 text-sm text-text outline-none focus:border-gold"
          />
          <button
            onClick={ask}
            disabled={busy || !question.trim()}
            className="rounded-lg border border-gold bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition hover:bg-gold/20 disabled:opacity-40"
          >
            {busy ? "Working…" : "Ask Support"}
          </button>
        </section>

        {obs?.run && (
          <section className="rounded-2xl border border-border bg-ink-2 p-5 space-y-4">
            {obs.run.errorCode && (
              <p className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
                {obs.run.errorCode}: {obs.run.errorMessage}
              </p>
            )}

            {out?.kind === "support-answer" && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-md border px-2 py-0.5 font-medium ${
                    out.coverage === "no-coverage"
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : "border-success/40 bg-success/10 text-success"
                  }`}>
                    {out.coverage === "kb-answered" ? "Answered from the knowledge base"
                      : out.coverage === "account-context" ? "Answered from your account status"
                        : "No answer found"}
                  </span>
                  {out.topics?.map((t) => (
                    <span key={t} className="rounded border border-border px-1.5 py-0.5 text-text-3">{t}</span>
                  ))}
                </div>

                {citedPassages.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold text-text-3">From the support knowledge base</h3>
                    <ul className="space-y-2 text-sm">
                      {citedPassages.map((c) => (
                        <li key={c.evidenceId} className="rounded-lg border border-border bg-ink p-3 text-text-2">
                          {c.evidence!.claim}
                          <div className="mt-1 text-[11px] text-text-3">{c.source}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {accountFacts.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold text-text-3">Your account status</h3>
                    <ul className="space-y-1 text-sm">
                      {accountFacts.map((f) => (
                        <li key={f.evidenceId} className="text-text-2">
                          <span className="text-text-3">[{f.domain}]</span> {f.evidence!.claim}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {out.escalate && (
                  <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm text-text-2">
                    <p className="font-medium text-gold">This needs a human.</p>
                    <p className="mt-1 text-xs text-text-3">
                      Reason: {String(out.escalationReason ?? "").replace(/-/g, " ")}. Please contact human support
                      &mdash; a support ticket flow is not yet wired into this assistant.
                    </p>
                  </div>
                )}

                {out.disclaimer && (
                  <p className="border-t border-border pt-3 text-[11px] text-text-3">{out.disclaimer}</p>
                )}
              </>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-text-3">Run detail</summary>
              <ol className="mt-2 space-y-1">
                {obs.timeline.map((s) => (
                  <li key={s.index} className="flex gap-2 text-text-3">
                    <span className="w-4 text-right">{s.index}</span>
                    <span className={s.status === "ok" ? "text-text-2" : "text-danger"}>{s.kind}</span>
                    <span className="truncate">{s.summary}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 font-mono text-[11px] text-text-3">run {obs.run.id} · {obs.run.status}</p>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
