"use client";

// components/workspace/WorkspaceAssistant.tsx
// Sprint D2.6.11 - Universal Instrument Workspace, Dynamic Chart Resolution
// & Live Workspace Integration. Replaces the stale "Embedded assistant
// arrives later in D2.3." placeholder with a real, minimal chat surface
// scoped to the Workspace's active instrument.
//
// This is NOT a second AI pipeline: every send hits the exact same
// /api/private/knowledge/chat route (D2.6.5-D2.6.10, unmodified) the
// dashboard Assistant page uses, with one additive parameter - `symbol`,
// the Workspace's own active WorkspaceContext.symbol - so a question like
// "What's happening?" (which mentions no instrument in its own text)
// resolves against the instrument the trader is actually looking at
// (services/intelligence/query/intelligence-query.service.ts's
// resolveSymbol(): explicit-in-text still wins, then this request-context
// value, then persisted conversation context). Changing the Workspace's
// active symbol changes what the NEXT question resolves against - matching
// the sprint's "select RELIANCE -> all components move to RELIANCE" rule.
// A resolved answer renders through the exact same VerifiedAIAnswerCard
// D2.6.10 already built (Why/What Could Happen/Risks/What Is Missing/
// provenance/audit trace) - no second answer UI.
import { useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import VerifiedAIAnswerCard from "@/components/intelligence-workspace/VerifiedAIAnswerCard";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  intelligence?: VerifiedAnswerResponse;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function WorkspaceAssistant() {
  const { symbol, name } = useWorkspace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  const send = async () => {
    const query = input.trim();
    if (!query || sending) return;
    setInput("");
    setError(false);
    setTurns((prev) => [...prev, { id: uid(), role: "user", text: query }]);
    setSending(true);
    try {
      const res = await fetch("/api/private/knowledge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, symbol, conversationId, useSearch: false, stream: false }),
      });
      const json = await res.json();
      if (json?.status === "ok" && typeof json.data?.content === "string") {
        if (typeof json.data.conversationId === "string") setConversationId(json.data.conversationId);
        const meta = json.data.intelligence;
        const intelligence: VerifiedAnswerResponse | undefined = meta?.resolved === true ? (meta as VerifiedAnswerResponse) : undefined;
        setTurns((prev) => [...prev, { id: uid(), role: "assistant", text: json.data.content as string, intelligence }]);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-3">
        Active instrument <span className="font-mono text-text-2">{symbol}</span>
        {name ? ` — ${name}` : ""}
      </p>

      <div className="space-y-4">
        {turns.length === 0 && (
          <p className="text-sm text-text-3">
            Ask about {symbol} — e.g. &ldquo;What&apos;s happening?&rdquo;, &ldquo;Why?&rdquo;, or &ldquo;What are the risks?&rdquo;
          </p>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ml-auto max-w-[85%] rounded-card bg-ink-3 px-4 py-2.5 text-sm text-text">
              {t.text}
            </div>
          ) : t.intelligence ? (
            <VerifiedAIAnswerCard key={t.id} result={t.intelligence} />
          ) : (
            <div key={t.id} className="max-w-[85%] rounded-card border border-border bg-ink-2 px-4 py-2.5 text-sm leading-6 text-text-2">
              {t.text}
            </div>
          ),
        )}
        {sending && <p className="text-xs text-text-3">Thinking…</p>}
        {error && <p className="text-sm text-signal-down">The assistant could not respond. Please try again.</p>}
      </div>

      <div className="flex items-end gap-2 border-t border-border pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={`Ask about ${symbol}...`}
          className="flex-1 resize-none rounded-control border border-border bg-ink px-3 py-2.5 text-sm text-text outline-none focus:border-gold/50"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          className="rounded-control bg-gold px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
