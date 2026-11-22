"use client";
// components/chart-engine/ProChat.tsx
// Chat tab of the Pro Chart. Not a second AI pipeline: every send goes to the same /api/private/knowledge/chat
// route the workspace assistant uses (verified answers, policy checks, daily limits), scoped to the chart's symbol.
import { useState } from "react";

interface Turn { id: string; role: "user" | "assistant"; text: string }

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function ProChat({ symbol, timeframe, getFacts }: { symbol: string; timeframe: string; getFacts: () => string | null }) {
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
      else if (res.status === 429) setError("Daily PRAGYA limit reached. Try again tomorrow.");
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
        {turns.length === 0 && <p className="text-[#9aa0ae]">Ask PRAGYA about {symbol}. Answers are written from this chart&apos;s measured numbers (EMA, RSI, ATR, structure, levels, plan) and never invent a number.</p>}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ml-auto max-w-[90%] rounded-lg bg-white/[0.08] px-3 py-2 text-white">{t.text}</div>
          ) : (
            <div key={t.id} className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 leading-relaxed text-[#d1d4dc]"><span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-violet-300">✦ PRAGYA</span>{t.text}</div>
          ),
        )}
        {sending && <p className="text-[#9aa0ae]">PRAGYA is reading the chart…</p>}
        {error && <p className="text-red-400">{error}</p>}
      </div>
      <div className="flex gap-1.5">
        {chips.map(([label, q]) => (
          <button key={label} type="button" disabled={sending} onClick={() => send(q)} className="flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[#d1d4dc] hover:bg-white/[0.09] disabled:opacity-40">
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
          className="flex-1 resize-none rounded-md border border-white/10 bg-[#0b0c10] px-3 py-2 text-white outline-none focus:border-white/30"
        />
        <button type="button" onClick={() => send(input)} disabled={sending || !input.trim()} className="rounded-md bg-gold px-3 py-2 font-semibold text-ink disabled:opacity-40">Send</button>
      </div>
    </div>
  );
}
