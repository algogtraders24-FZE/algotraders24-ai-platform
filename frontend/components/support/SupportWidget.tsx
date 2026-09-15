"use client";
// components/support/SupportWidget.tsx
// AT24 Support - P1 (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS5/SS6/SS7/SS12/
// SS13). The site-wide floating support widget, mounted once at
// app/layout.tsx (root) - visible on every page, public and dashboard.
//
// Two runtime modes, selected by a non-authoritative session probe
// (SS7/SS11) and switchable mid-conversation on login (SS6/SS12):
//   - guest:         POST /api/support/guest, one request per message, no
//                     server-side persistence at all (P1 D11) - the visible
//                     transcript lives only in this component's state +
//                     sessionStorage.
//   - authenticated: the EXACT existing CS1 client flow via the shared
//                     useSupportRun hook (also used by
//                     app/dashboard/support/page.tsx) - a real AgentRun per
//                     question, full L2 capability, unchanged from CS1.
//
// The session probe is UX-only: it never grants anything. The authenticated
// path independently re-verifies the real session server-side regardless of
// what the probe returned (SS7/SS11).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import {
  useSupportRun,
  isResolutionConfirmationEligible,
  type Observability,
  type SupportOutput,
} from "@/hooks/useSupportRun";
import type { GuestAnswer, GuestCitation } from "@/services/support/guest-knowledge-query";

type Mode = "unknown" | "guest" | "authenticated";
type GuestTurn = { question: string; answer: GuestAnswer };

const GUEST_THREAD_KEY = "at24-support-guest-thread";
const CONTACT_HREF = "/company/contact";

function loadGuestTurns(): GuestTurn[] {
  try {
    const raw = window.sessionStorage.getItem(GUEST_THREAD_KEY);
    return raw ? (JSON.parse(raw) as GuestTurn[]) : [];
  } catch {
    return [];
  }
}

function persistGuestTurns(turns: GuestTurn[]): void {
  try {
    window.sessionStorage.setItem(GUEST_THREAD_KEY, JSON.stringify(turns));
  } catch {
    // best-effort only - private browsing / storage disabled is fine, the
    // conversation just doesn't survive a reload (P1 SS6: nothing server-
    // side to fall back to for a guest anyway).
  }
}

async function probeAuthenticated(): Promise<boolean> {
  try {
    const res = await fetch("/api/support/session");
    const json = await res.json().catch(() => null);
    return Boolean(json?.data?.authenticated);
  } catch {
    return false; // fail toward the narrower, safer surface (guest mode grants nothing account-related)
  }
}

function EscalationNotice({ reason }: { reason: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm text-text-2">
      <p className="font-medium text-gold">This needs a human.</p>
      <p className="mt-1 text-xs text-text-3">
        Reason: {String(reason ?? "").replace(/-/g, " ")}.
      </p>
      <Link href={CONTACT_HREF} className="mt-2 inline-block text-xs font-semibold text-gold underline">
        Talk to a human &rarr;
      </Link>
    </div>
  );
}

function GuestCitationList({ citations }: { citations: GuestCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul className="space-y-2 text-sm">
      {citations.map((c, i) => (
        <li key={`${c.topic}-${i}`} className="rounded-lg border border-border bg-ink p-3 text-text-2">
          {c.content}
          <div className="mt-1 text-[11px] text-text-3">{c.title || c.topic}</div>
        </li>
      ))}
    </ul>
  );
}

function GuestTurnView({ turn }: { turn: GuestTurn }) {
  return (
    <div className="space-y-2">
      <p className="rounded-lg bg-ink-3 px-3 py-2 text-sm text-text">{turn.question}</p>
      <GuestCitationList citations={turn.answer.citations} />
      {turn.answer.escalate && <EscalationNotice reason={turn.answer.escalationReason} />}
      {turn.answer.coverage === "no-coverage" && !turn.answer.escalate && (
        <p className="text-xs text-text-3">No answer found in the public support knowledge base.</p>
      )}
    </div>
  );
}

function AuthTurnView({
  question,
  obs,
  live,
  onConfirm,
  confirmBusy,
  confirmError,
}: {
  question: string;
  obs: Observability;
  live: boolean;
  onConfirm?: (confirmed: boolean) => void;
  confirmBusy?: boolean;
  confirmError?: string | null;
}) {
  const out = (obs.run?.output ?? null) as SupportOutput | null;
  const evById = new Map(obs.evidence.map((e) => [e.id, e]));
  const citations = (out?.citations ?? []).map((c) => ({ ...c, evidence: evById.get(c.evidenceId) })).filter((c) => c.evidence);
  const accountFacts = (out?.accountFindings ?? []).map((f) => ({ ...f, evidence: evById.get(f.evidenceId) })).filter((f) => f.evidence);
  const confirmation = obs.run?.metadata?.resolutionConfirmation;
  const eligible = live && isResolutionConfirmationEligible(obs) && onConfirm;

  return (
    <div className="space-y-2">
      <p className="rounded-lg bg-ink-3 px-3 py-2 text-sm text-text">{question}</p>

      {out?.kind === "support-answer" && (
        <>
          {citations.length > 0 && (
            <ul className="space-y-2 text-sm">
              {citations.map((c) => (
                <li key={c.evidenceId} className="rounded-lg border border-border bg-ink p-3 text-text-2">
                  {c.evidence!.claim}
                  <div className="mt-1 text-[11px] text-text-3">{c.source}</div>
                </li>
              ))}
            </ul>
          )}
          {accountFacts.length > 0 && (
            <ul className="space-y-1 text-sm">
              {accountFacts.map((f) => (
                <li key={f.evidenceId} className="text-text-2">
                  <span className="text-text-3">[{f.domain}]</span> {f.evidence!.claim}
                </li>
              ))}
            </ul>
          )}
          {out.escalate && <EscalationNotice reason={out.escalationReason} />}
        </>
      )}

      {eligible && (
        <div className="flex items-center gap-2 text-xs text-text-2">
          <span>Did this resolve your issue?</span>
          <Button size="sm" variant="secondary" onClick={() => onConfirm!(true)} loading={confirmBusy}>
            Yes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onConfirm!(false)} disabled={confirmBusy}>
            No
          </Button>
        </div>
      )}
      {confirmation && (
        <p className="text-[11px] text-text-3">
          {confirmation.confirmed ? "Marked resolved - thanks for confirming." : "Noted - feel free to ask a follow-up."}
        </p>
      )}
      {confirmError && <p className="text-[11px] text-danger">{confirmError}</p>}
    </div>
  );
}

export default function SupportWidget() {
  const [mode, setMode] = useState<Mode>("unknown");
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const [guestTurns, setGuestTurns] = useState<GuestTurn[]>([]);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);

  const { obs, busy, error, ask, confirmResolution, confirmBusy, confirmError } = useSupportRun();
  const [authHistory, setAuthHistory] = useState<{ question: string; obs: Observability }[]>([]);
  const [authQuestion, setAuthQuestion] = useState<string | null>(null);

  // Guest thread restore is client-only (sessionStorage) - deferred to an
  // effect so the initial server/client render matches (no hydration
  // mismatch) and nothing server-side is ever touched for a guest (SS6).
  useEffect(() => {
    setGuestTurns(loadGuestTurns());
  }, []);

  // The auth-state probe is re-run on mount and on window focus (SS13) -
  // catches "logged in in another tab, came back to this one" without a
  // persistent socket/interval.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const authenticated = await probeAuthenticated();
      if (!cancelled) setMode(authenticated ? "authenticated" : "guest");
    };
    run();
    window.addEventListener("focus", run);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", run);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open]);

  const sendGuest = useCallback(async (text: string) => {
    setGuestError(null);
    setGuestBusy(true);
    try {
      const res = await fetch("/api/support/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.status !== "ok") {
        throw new Error(json?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      setGuestTurns((turns) => {
        const next = [...turns, { question: text, answer: json.data as GuestAnswer }];
        persistGuestTurns(next);
        return next;
      });
    } catch (e) {
      setGuestError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuestBusy(false);
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (mode === "authenticated") {
      if (authQuestion && obs) setAuthHistory((h) => [...h, { question: authQuestion, obs }]);
      setAuthQuestion(text);
      await ask(text);
    } else {
      await sendGuest(text);
    }
  }, [input, mode, authQuestion, obs, ask, sendGuest]);

  const busyNow = mode === "authenticated" ? busy : guestBusy;
  const errorNow = mode === "authenticated" ? error : guestError;
  const hasAnyTurn = mode === "authenticated" ? authHistory.length > 0 || obs?.run != null : guestTurns.length > 0;

  return (
    <>
      {/* bottom-24 (not bottom-6): app/dashboard/layout.tsx's FeedbackWidget
          already occupies bottom-6 right-6 on every dashboard page - this
          widget is root-mounted (SS6) so it renders alongside it there.
          Stacking above it, not overlapping, is the only change this needed.
          z-[60] (not z-40): the site's own fixed header (components/layout/
          Navbar.tsx) is z-50 - on mobile, where the panel is fixed inset-0
          (full-screen), z-40 let the header/logo paint on top of it. z-[60]
          keeps the launcher and the full-screen panel above every page's own
          fixed chrome. */}
      <Button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close support chat" : "Open support chat"}
        className="fixed bottom-24 right-6 z-[60] !rounded-full shadow-floating"
      >
        {open ? "Close" : "Support"}
      </Button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Support chat"
          className="fixed inset-0 z-[60] flex flex-col bg-ink-2 sm:inset-auto sm:bottom-40 sm:right-6 sm:h-[32rem] sm:w-96 sm:rounded-panel sm:border sm:border-border sm:shadow-overlay"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-text">Support</h2>
              <p className="text-[11px] text-text-3">
                {mode === "authenticated"
                  ? "Answers from AT24's support knowledge base and your account status."
                  : mode === "guest"
                    ? "Answers from AT24's public support knowledge base. Sign in for account help."
                    : "Loading…"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/dashboard/support" className="text-[11px] text-text-3 underline hover:text-text">
                Open full page
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-text-3 transition hover:text-text"
              >
                &times;
              </button>
            </div>
          </div>

          <div aria-live="polite" className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {!hasAnyTurn && (
              <p className="text-xs text-text-3">
                Ask a question about billing, licenses, your subscription, or how the platform works.
              </p>
            )}

            {mode === "authenticated" &&
              authHistory.map((h, i) => <AuthTurnView key={i} question={h.question} obs={h.obs} live={false} />)}
            {mode === "authenticated" && authQuestion && obs?.run && (
              <AuthTurnView
                question={authQuestion}
                obs={obs}
                live
                onConfirm={confirmResolution}
                confirmBusy={confirmBusy}
                confirmError={confirmError}
              />
            )}

            {mode !== "authenticated" && guestTurns.map((t, i) => <GuestTurnView key={i} turn={t} />)}

            {busyNow && <p className="text-xs text-text-3">Working…</p>}
            {errorNow && <p className="text-xs text-danger">{errorNow}. Please try again.</p>}
          </div>

          <div className="flex items-center gap-2 border-t border-border px-3 py-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask a support question…"
              disabled={busyNow}
              aria-label="Your question"
            />
            <Button onClick={send} disabled={busyNow || !input.trim()} loading={busyNow} size="sm">
              Send
            </Button>
          </div>
          <Link href={CONTACT_HREF} className="border-t border-border px-4 py-2 text-center text-[11px] text-text-3 underline hover:text-text">
            Talk to a human
          </Link>
        </div>
      )}
    </>
  );
}
