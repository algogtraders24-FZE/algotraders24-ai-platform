"use client";
// components/chart-engine/ProChat.tsx
// Chat tab of the Pro Chart. Not a second AI pipeline: every send goes to the same /api/private/knowledge/chat
// route the workspace assistant uses (verified answers, policy checks, daily limits), scoped to the chart's symbol.
import { useState } from "react";
import VerifiedAIAnswerCard from "@/components/intelligence-workspace/VerifiedAIAnswerCard";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";

interface Turn { id: string; role: "user" | "assistant"; text: string; intelligence?: VerifiedAnswerResponse }

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function ProChat({ symbol, timeframe }: { symbol: string; timeframe: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  const chips: [string, string][] = [
    ["Entry", `What entry area makes sense for ${symbol} on ${timeframe.toUpperCase()} right now, with a stop and target, and what is the risk?`],
    ["Trend", `What is the current trend and structure of ${symbol} on ${timeframe.toUpperCase()}?`],
    ["Risk", `What are the main risks for ${symbol} right now?`],
  ];

  async function send(text: string) {
    const query = text.trim();
    if (!query || sending) return;
    setInput("");
    setError(false);
    setTurns((p) => [...p, { id: uid(), role: "user", text: query }]);
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
        setTurns((p) => [...p, { id: uid(), role: "assistant", text: json.data.content as string, intelligence: meta?.resolved === true ? (meta as VerifiedAnswerResponse) : undefined }]);
      } else setError(true);
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="max-h-[420px] space-y-3 overflow-y-auto">
        {turns.length === 0 && <p className="text-text-3">Ask about {symbol}. Answers use the platform&apos;s verified data and state their sources.</p>}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ml-auto max-w-[90%] rounded-card bg-ink-3 px-3 py-2 text-text">{t.text}</div>
          ) : t.intelligence ? (
            <VerifiedAIAnswerCard key={t.id} result={t.intelligence} />
          ) : (
            <div key={t.id} className="rounded-card border border-border bg-ink-2 px-3 py-2 leading-5 text-text-2">{t.text}</div>
          ),
        )}
        {sending && <p className="text-text-3">Thinking…</p>}
        {error && <p className="text-signal-down">The assistant could not respond. Please try again.</p>}
      </div>
      <div className="flex gap-1.5">
        {chips.map(([label, q]) => (
          <button key={label} type="button" disabled={sending} onClick={() => send(q)} className="flex-1 rounded-control border border-border bg-ink-3 px-2 py-1.5 text-text-2 hover:text-text disabled:opacity-40">
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          rows={1}
          placeholder="Ask anything..."
          className="flex-1 resize-none rounded-control border border-border bg-ink px-3 py-2 text-text outline-none focus:border-gold/50"
        />
        <button type="button" onClick={() => send(input)} disabled={sending || !input.trim()} className="rounded-control bg-gold px-3 py-2 font-semibold text-ink disabled:opacity-40">Send</button>
      </div>
    </div>
  );
}
