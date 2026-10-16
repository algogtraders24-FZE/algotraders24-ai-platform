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
//
// P1 (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS7/SS13/SS17): refactor only - the
// run/poll `ask()` sequence now lives in the shared `useSupportRun` hook
// (also used by the new site-wide SupportWidget) instead of being
// duplicated. UI and behavior here are unchanged; the resolution-
// confirmation prompt is intentionally a widget-only affordance in P1
// (contract SS5/SS10) and is not added to this page.
// Sprint UI-02.7 - cross-dashboard consistency: self min-h-screen/max-w-3xl
// wrapper removed (AppShell already provides it), the gradient hero header
// (bg-gradient-to-r from-gold/20 to-gold/10 - a direct violation of the
// locked no-gradients direction) replaced with PageHeader, every hand-rolled
// rounded-2xl/rounded-lg box -> Card, every hand-rolled button -> Button,
// the top-level error banner -> Alert. Same useSupportRun hook, same
// ask/handoff/requestHuman/sendHandoffMessage/reopenHandoff calls, same
// SUPPORT-agent-only routing (CS1.2 D1) - no behavior touched.
import { useEffect, useState } from "react";
import { useSupportRun, isHandoffActive } from "@/hooks/useSupportRun";
import type { SupportOutput } from "@/hooks/useSupportRun";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Textarea from "@/components/ui/Textarea";
import AnswerFeedback from "@/components/support/AnswerFeedback";
import QuickReplies from "@/components/support/QuickReplies";

export default function SupportAssistantPage() {
  const [question, setQuestion] = useState("");
  const [handoffReply, setHandoffReply] = useState("");
  const { obs, busy, stage, error, ask, reset, conversations, pastTurns, historyBusy, historyError, loadConversations, openConversation, handoff, handoffBusy, handoffError, loadHandoff, requestHuman, sendHandoffMessage, reopenHandoff } = useSupportRun();

  // Email deep link (/dashboard/support?handoff=<id>): rehydrate the case so
  // a user returning from a "support replied" email sees the thread.
  // window.location (not useSearchParams) avoids a Suspense boundary.
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("handoff");
    if (id) void loadHandoff(id);
  }, [loadHandoff]);

  const out = (obs?.run?.output ?? null) as SupportOutput | null;
  const evById = new Map((obs?.evidence ?? []).map((e) => [e.id, e]));
  const citedPassages = (out?.citations ?? [])
    .map((c) => ({ ...c, evidence: evById.get(c.evidenceId) }))
    .filter((c) => c.evidence);
  const accountFacts = (out?.accountFindings ?? [])
    .map((f) => ({ ...f, evidence: evById.get(f.evidenceId) }))
    .filter((f) => f.evidence);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Account"
        title="AT24 Copilot"
        description="Answers from AT24's own support knowledge base and the read-only status of your own account. It cannot change your account, billing, credits or licenses - when it can't resolve a question it hands off to a human. Separate from the main AI Assistant."
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {handoffError && !isHandoffActive(handoff?.status) && <Alert tone="danger">{handoffError}</Alert>}

      {/* A closed case opened via email link: show the thread read-only so
          the resolution reply is visible; the question card below still
          offers "This isn't resolved" (RESOLVED only). */}
      {handoff && !isHandoffActive(handoff.status) && handoff.messages.length > 0 && (
        <Card className="space-y-3">
          <p className="text-sm font-medium text-text-2">
            {handoff.status === "RESOLVED" ? "This support case was marked resolved." : "This support case was closed."}
          </p>
          <ul className="space-y-2">
            {handoff.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-control p-3 text-sm ${m.authorType === "HUMAN" ? "border border-border bg-ink text-text-2" : "bg-ink-3 text-text"}`}
              >
                {m.content}
                <div className="mt-1 text-[11px] text-text-3">{m.authorType === "HUMAN" ? "Support team" : "You"}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

        {/* AT24 Copilot history: earlier conversations of THIS user (server-scoped); opening one shows
            its turns and continues it. */}
        {conversations.length > 0 && (
          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-2">Recent conversations</h2>
              <Button size="sm" variant="secondary" onClick={reset} disabled={busy}>
                New conversation
              </Button>
            </div>
            <ul className="space-y-1">
              {conversations.slice(0, 5).map((c) => (
                <li key={c.conversationId}>
                  <button
                    type="button"
                    onClick={() => void openConversation(c.conversationId)}
                    disabled={historyBusy || busy}
                    className="flex w-full items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left text-sm text-text-2 hover:bg-ink-3 disabled:opacity-50"
                  >
                    <span className="truncate">{c.title}</span>
                    <span className="shrink-0 text-[11px] text-text-3">
                      {c.turns} {c.turns === 1 ? "message" : "messages"} · {new Date(c.lastActivityAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {historyError && <p className="text-xs text-danger">{historyError}</p>}
          </Card>
        )}

        {pastTurns.length > 0 && (
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold text-text-2">Earlier in this conversation</h2>
            <ul className="space-y-3">
              {pastTurns.map((t) => (
                <li key={t.runId} className="space-y-1 text-sm">
                  <p className="rounded-control bg-ink-3 px-3 py-2 text-text">{t.question}</p>
                  {t.answer ? (
                    <p className="whitespace-pre-line rounded-control border border-border bg-ink px-3 py-2 text-text-2">{t.answer}</p>
                  ) : (
                    <p className="px-1 text-xs text-text-3">{t.escalate ? "This was handed to our team." : "No written answer was saved for this turn."}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Support Human Handoff MVP - while a case is active, this page's
            input sends to the human thread, never a new AgentRun (D11) -
            same routing rule the widget uses. */}
        {isHandoffActive(handoff?.status) ? (
          <Card className="space-y-3" style={{ borderColor: "rgba(212, 175, 55, 0.4)", background: "rgba(212, 175, 55, 0.05)" }}>
            <p className="text-sm font-medium text-gold">
              {handoff!.status === "OPEN" && "Your request has been sent to our support team."}
              {handoff!.status === "ASSIGNED" && "A member of our support team has picked up your case."}
              {handoff!.status === "IN_PROGRESS" && "Our support team is working on your case."}
            </p>
            {handoff!.messages.length > 0 && (
              <ul className="space-y-2">
                {handoff!.messages.map((m) => (
                  <li
                    key={m.id}
                    className={`rounded-control p-3 text-sm ${m.authorType === "HUMAN" ? "border border-border bg-ink text-text-2" : "bg-ink-3 text-text"}`}
                  >
                    {m.content}
                    <div className="mt-1 text-[11px] text-text-3">{m.authorType === "HUMAN" ? "Support team" : "You"}</div>
                  </li>
                ))}
              </ul>
            )}
            <Textarea value={handoffReply} onChange={(e) => setHandoffReply(e.target.value)} rows={2} placeholder="Message our support team…" />
            <Button
              onClick={async () => {
                if (!handoffReply.trim()) return;
                await sendHandoffMessage(handoffReply.trim());
                setHandoffReply("");
              }}
              loading={handoffBusy}
              disabled={!handoffReply.trim()}
            >
              Send to support
            </Button>
            {handoffError && <p className="text-xs text-danger">{handoffError}</p>}
          </Card>
        ) : (
          <Card className="space-y-3">
            <label htmlFor="support-q" className="text-sm font-semibold text-text-2">Your question</label>
            <Textarea
              id="support-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="e.g. How do I upgrade my plan, and what is my subscription status?"
            />
            <Button onClick={() => ask(question)} loading={busy} disabled={!question.trim()}>
              Ask Copilot
            </Button>
            {busy && stage && <p className="text-xs text-text-3" aria-live="polite">{stage}</p>}
            {!obs?.run && !busy && !handoff && (
              <QuickReplies onPick={(q) => { setQuestion(q); void ask(q); }} />
            )}
            {handoff?.status === "RESOLVED" && (
              <Button variant="secondary" onClick={reopenHandoff} disabled={handoffBusy} className="ml-2">
                This isn&rsquo;t resolved
              </Button>
            )}
          </Card>
        )}

        {obs?.run && (
          <Card className="space-y-4">
            {obs.run.errorCode && (
              <p className="rounded-control border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
                {obs.run.errorCode}: {obs.run.errorMessage}
              </p>
            )}

            {out?.kind === "support-answer" && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={out.coverage === "no-coverage" ? "danger" : "success"}>
                    {out.coverage === "kb-answered" ? "Answered from the knowledge base"
                      : out.coverage === "account-context" ? "Answered from your account status"
                        : out.coverage === "kb-generated" ? "Generated from the support knowledge base"
                          : "No answer found"}
                  </Badge>
                  {out.topics?.map((t) => (
                    <span key={t} className="rounded border border-border px-1.5 py-0.5 text-text-3">{t}</span>
                  ))}
                </div>

                {out.coverage === "kb-generated" && out.generatedAnswer && (
                  <div className="rounded-control border border-border bg-ink p-3 text-sm text-text-2">
                    {out.generatedAnswer}
                    <div className="mt-1 text-[11px] text-text-3">
                      Generated from the support knowledge base{out.generatedProvider ? ` (${out.generatedProvider})` : ""} - not a direct citation.
                    </div>
                  </div>
                )}

                {out.composedAnswer && (
                  <div className="whitespace-pre-line rounded-control border border-border bg-ink p-3 text-sm text-text">{out.composedAnswer}</div>
                )}

                {citedPassages.length > 0 && (
                  <details open={!out.composedAnswer}>
                    <summary className="mb-1 cursor-pointer text-xs font-semibold text-text-3">
                      {out.composedAnswer ? `Sources (${citedPassages.length})` : "From the support knowledge base"}
                    </summary>
                    <ul className="mt-1 space-y-2 text-sm">
                      {citedPassages.map((c) => (
                        <li key={c.evidenceId} className="rounded-control border border-border bg-ink p-3 text-text-2">
                          {c.evidence!.claim}
                          <div className="mt-1 text-[11px] text-text-3">{c.source}</div>
                        </li>
                      ))}
                    </ul>
                  </details>
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

                {out.escalate && !handoff && (
                  <div className="rounded-control border border-gold/40 bg-gold/10 p-3 text-sm text-text-2">
                    <p className="font-medium text-gold">This needs a human.</p>
                    <p className="mt-1 text-xs text-text-3">
                      Reason: {String(out.escalationReason ?? "").replace(/-/g, " ")}.
                    </p>
                    <Button size="sm" onClick={requestHuman} loading={handoffBusy} className="mt-2">
                      Connect me to support
                    </Button>
                  </div>
                )}

                {out.coverage !== "no-coverage" && obs.run?.id && (
                  <AnswerFeedback key={obs.run.id} runId={obs.run.id} initial={obs.run.metadata?.feedback?.value} />
                )}

                {(out.composedAnswer || out.generatedAnswer) ? (
                  <p className="border-t border-border pt-3 text-[11px] text-text-3">
                    Written by AT24 Copilot from AT24&apos;s support knowledge base; sources are listed so you can check it. It is read-only and cannot change your account, billing, credits or licenses. Not financial advice.
                  </p>
                ) : (
                  out.disclaimer && <p className="border-t border-border pt-3 text-[11px] text-text-3">{out.disclaimer}</p>
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
          </Card>
        )}
    </div>
  );
}
