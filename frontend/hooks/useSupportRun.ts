"use client";
// hooks/useSupportRun.ts
// AT24 Agent Framework - P1 (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS7/SS13/
// SS17). Shared authenticated SUPPORT-agent run/poll/confirm logic,
// extracted unchanged in behavior from app/dashboard/support/page.tsx's
// original inline `ask()` (CS1) - used by both that page and the new
// site-wide SupportWidget so the run/poll/confirm sequence has exactly one
// implementation instead of two that could drift.
import { useCallback, useState } from "react";

export type Evidence = { id: string; type: string; claim: string; source: string };

export type SupportOutput = {
  kind?: string;
  resolved?: boolean;
  coverage?: "kb-answered" | "account-context" | "no-coverage" | "kb-generated";
  citationCount?: number;
  topics?: string[];
  citations?: { evidenceId: string; topic: string; source: string; relevance: number }[];
  accountFindings?: { evidenceId: string; domain: string }[];
  escalate?: boolean;
  escalationReason?: string | null;
  disclaimer?: string;
  /** Phase A generative fallback only - present when coverage is
   *  "kb-generated". Never present for "kb-answered" (a real citation), by
   *  construction - see services/support/generate-answer.ts. */
  generatedAnswer?: string;
  generatedProvider?: string;
};

export type ResolutionConfirmation = { confirmed: boolean; confirmedAt: string };

// Support Human Handoff MVP (SUPPORT_HUMAN_HANDOFF_ARCHITECTURE_LOCK.md) -
// AT24's first internal Support Ticket/Case system. The backend canonical
// name is SupportHandoff; this hook's own naming stays "handoff" too, to
// match services/support/handoff-service.ts exactly - product copy is free
// to say "Support Case" without renaming anything at the code layer.
export type HandoffMessage = { id: string; authorType: string; content: string; createdAt: string };
export type SupportHandoff = {
  id: string;
  status: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";
  createdAt: string;
  resolvedAt: string | null;
  messages: HandoffMessage[];
};

/** D11 - the exact "active" set; a widget/page must route a new user
 *  message to sendHandoffMessage() while true, and to ask() once false. */
export function isHandoffActive(status: SupportHandoff["status"] | undefined): boolean {
  return status === "OPEN" || status === "ASSIGNED" || status === "IN_PROGRESS";
}

export type Observability = {
  run: {
    id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    output: unknown;
    metadata?: { resolutionConfirmation?: ResolutionConfirmation } | null;
  } | null;
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

/** True only when the widget should show "Did this resolve your issue?"
 *  (P1 contract SS10): the run is terminal, actually answered
 *  (coverage !== "no-coverage"), not escalated, and not already confirmed
 *  either way. This is the CLIENT-side half of the eligibility gate; the
 *  server (recordResolutionConfirmation) independently re-checks the same
 *  conditions for a positive confirmation - defense in depth, not the only
 *  check (G5). */
export function isResolutionConfirmationEligible(obs: Observability | null): boolean {
  if (!obs?.run) return false;
  if (!TERMINAL.has(obs.run.status)) return false;
  if (obs.run.metadata?.resolutionConfirmation) return false;
  const out = obs.run.output as SupportOutput | null;
  if (!out || out.kind !== "support-answer") return false;
  if (out.coverage === "no-coverage") return false;
  if (out.escalate) return false;
  return true;
}

export function useSupportRun() {
  const [obs, setObs] = useState<Observability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Phase B (Support conversation continuity): remembered across ask() calls
  // within the SAME hook instance so a follow-up question continues the same
  // backend conversation - context feeds Phase A's generative fallback only
  // (services/support/generate-answer.ts); the deterministic KB-match /
  // account-lookup / mutation-escalation paths are unaffected. Undefined on
  // the first ask(); the server generates and returns one, every later
  // ask() echoes it back. No other UI change needed - the widget already
  // accumulates a visible multi-turn thread (authHistory) client-side.
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  // Support Human Handoff MVP - the active handoff (if any) for the
  // current conversation. Refreshed after every ask() cycle (covers the
  // AI_ESCALATION auto-creation path, which happens server-side inside
  // advanceAgentRun with no separate client action) and after every
  // handoff-specific action below.
  const [handoff, setHandoff] = useState<SupportHandoff | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const refreshHandoff = useCallback(async (forConversationId: string | undefined) => {
    if (!forConversationId) return;
    try {
      const { handoff: active } = await api<{ handoff: SupportHandoff | null }>(
        `/api/private/support/handoff?conversationId=${encodeURIComponent(forConversationId)}`,
      );
      setHandoff(active);
    } catch {
      // best-effort - a failed handoff check must never block the
      // underlying Support answer from rendering.
    }
  }, []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    setError(null);
    setBusy(true);
    setObs(null);
    try {
      const { runId, conversationId: nextConversationId } = await api<{ runId: string; conversationId?: string }>(
        "/api/private/agents/framework/runs",
        {
          method: "POST",
          body: JSON.stringify({ agentType: "SUPPORT", goal: { question: q }, conversationId }),
        },
      );
      if (nextConversationId) setConversationId(nextConversationId);
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
      await refreshHandoff(nextConversationId ?? conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [conversationId, refreshHandoff]);

  /** "Talk to a human" (D2 USER_REQUEST). Creates or reuses the
   *  conversation's active handoff - a no-op-looking call if one already
   *  exists (D1), never a duplicate ticket. */
  const requestHuman = useCallback(async () => {
    if (!conversationId) return;
    setHandoffError(null);
    setHandoffBusy(true);
    try {
      const { handoffId } = await api<{ handoffId: string; status: string }>("/api/private/support/handoff", {
        method: "POST",
        body: JSON.stringify({ conversationId }),
      });
      const { handoff: detail } = await api<{ handoff: SupportHandoff }>(`/api/private/support/handoff/${handoffId}`);
      setHandoff(detail);
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
  }, [conversationId]);

  /** D11: a new message while the handoff is active - never a new
   *  AgentRun. The caller (widget/page) is responsible for checking
   *  isHandoffActive(handoff?.status) and routing here instead of ask(). */
  const sendHandoffMessage = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || !handoff) return;
      setHandoffError(null);
      setHandoffBusy(true);
      try {
        const { handoff: updated } = await api<{ handoff: SupportHandoff }>(`/api/private/support/handoff/${handoff.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: text }),
        });
        setHandoff(updated);
      } catch (e) {
        setHandoffError(e instanceof Error ? e.message : String(e));
      } finally {
        setHandoffBusy(false);
      }
    },
    [handoff],
  );

  /** §18: the one transition a regular user may trigger themselves
   *  (RESOLVED -> OPEN, own handoff only). */
  const reopenHandoff = useCallback(async () => {
    if (!handoff) return;
    setHandoffError(null);
    setHandoffBusy(true);
    try {
      const { handoff: updated } = await api<{ handoff: SupportHandoff }>(`/api/private/support/handoff/${handoff.id}/reopen`, {
        method: "POST",
      });
      setHandoff(updated);
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
  }, [handoff]);

  /** POST the caller's explicit resolution answer for the CURRENT run
   *  (P1 SS10). A no-op if there is no run yet. */
  const confirmResolution = useCallback(
    async (confirmed: boolean) => {
      const runId = obs?.run?.id;
      if (!runId) return;
      setConfirmError(null);
      setConfirmBusy(true);
      try {
        const { run } = await api<{ run: Observability }>(`/api/private/agents/framework/runs/${runId}/resolution`, {
          method: "POST",
          body: JSON.stringify({ confirmed }),
        });
        setObs(run);
      } catch (e) {
        setConfirmError(e instanceof Error ? e.message : String(e));
      } finally {
        setConfirmBusy(false);
      }
    },
    [obs?.run?.id],
  );

  const reset = useCallback(() => {
    setObs(null);
    setError(null);
    setConfirmError(null);
    setConversationId(undefined); // start a genuinely new conversation, not a continued one
    setHandoff(null);
    setHandoffError(null);
  }, []);

  return {
    obs,
    busy,
    error,
    ask,
    confirmResolution,
    confirmBusy,
    confirmError,
    reset,
    conversationId,
    handoff,
    handoffBusy,
    handoffError,
    requestHuman,
    sendHandoffMessage,
    reopenHandoff,
  };
}
