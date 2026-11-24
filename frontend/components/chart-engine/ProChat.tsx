"use client";
// components/chart-engine/ProChat.tsx
// Chat tab of the Pro Chart. Not a second AI pipeline: every send goes to the same /api/private/knowledge/chat
// route the workspace assistant uses (verified answers, policy checks, daily limits), scoped to the chart's symbol.
import { useState } from "react";

interface Turn { id: string; role: "user" | "assistant"; text: string }

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function ProChat({ symbol, timeframe, getFacts, onAnalyze }: { symbol: string; timeframe: string; getFacts: () => string | null; onAnalyze?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chips: [string, string][] = [
    ["Entry", "Where is a sensible entry area right now, with the stop and the target, and what is the risk?"],
    ["Trend", "What is the current trend and structure?"],
    ["Risk", "What are the main risks right now?"],
  ];

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;
    setInput("");
    setError(null);
    setTurns((p) => [...p, { id: uid(), role: "user", text: question }]);
    const facts = getFacts();
    if (!facts) {
      setTurns((p) => [...p, { id: uid(), role: "assistant", text: "There are not enough candles on this chart yet for PRAGYA to read it." }]);
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/private/pragya/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe, facts, question }),
      });
      const json = await res.json();
      if (json?.status === "ok" && typeof json.data?.text === "string") setTurns((p) => [...p, { id: uid(), role: "assistant", text: json.data.text as string }]);
      else if (res.status === 403) setError("Your 30 free days are over. PRAGYA is part of the Pro plan (see Pro plans on the Chat tab).");
      else if (res.status === 429) setError("Daily PRAGYA limit reached. It resets at 00:00 UTC.");
      else setError("PRAGYA could not answer that from the chart's measured facts. Try rephrasing the question.");
    } catch {
      setError("PRAGYA is not reachable right now. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <div className="max-h-[calc(100vh-260px)] space-y-3 overflow-y-auto">
        {turns.length === 0 && (
          <ul className="flex flex-col">
            {([
              ["Analyze the chart", null],
              ["Where's the entry?", "Where is a sensible entry area right now, with the stop and the target, and what is the risk?"],
              ["What's the trend?", "What is the current trend and structure?"],
              ["What's my risk here?", "What are the main risks right now?"],
              ["Show me key levels", "Which support and resistance levels matter right now?"],
              ["Any patterns forming?", "Is any chart pattern forming (double top, double bottom, structure)?"],
            ] as [string, string | null][]).map(([label, q]) => (
              <li key={label}>
                <button type="button" onClick={() => (q ? send(q) : onAnalyze?.())} className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left text-[14px] text-text-2 hover:bg-ink-4">
                  <span className="text-gold">✦</span>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ml-auto max-w-[90%] rounded-lg bg-ink-4 px-3 py-2 text-text">{t.text}</div>
          ) : (
            <div key={t.id} className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 leading-relaxed text-text-2"><span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-gold">✦ PRAGYA</span>{t.text}</div>
          ),
        )}
        {sending && <p className="text-text-3">PRAGYA is reading the chart…</p>}
        {error && <p className="text-red-400">{error}</p>}
      </div>
      <div className="flex gap-1.5">
        {chips.map(([label, q]) => (
          <button key={label} type="button" disabled={sending} onClick={() => send(q)} className="flex-1 rounded-md border border-border bg-ink-3 px-2 py-1.5 text-text-2 hover:bg-ink-4 disabled:opacity-40">
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
          placeholder="Ask PRAGYA anything..."
          className="flex-1 resize-none rounded-md border border-border bg-ink px-3 py-2 text-text outline-none focus:border-text-3"
        />
        <button type="button" onClick={() => send(input)} disabled={sending || !input.trim()} className="rounded-md bg-gold px-3 py-2 font-semibold text-ink disabled:opacity-40">Send</button>
      </div>
    </div>
  );
}
