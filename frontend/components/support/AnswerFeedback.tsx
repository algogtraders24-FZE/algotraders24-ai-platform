"use client";
// components/support/AnswerFeedback.tsx
// AT24 Copilot Phase 4: thumbs up / down under an answer. Self-contained (posts to
// /api/private/support/feedback); the rating is remembered on the run, so it survives a reload.
import { useState } from "react";

type Rating = "up" | "down";

export default function AnswerFeedback({ runId, initial }: { runId: string; initial?: Rating }) {
  const [value, setValue] = useState<Rating | undefined>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function rate(next: Rating) {
    if (busy || next === value) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/private/support/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, value: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setValue(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const base = "rounded-control border px-2 py-0.5 text-xs transition-colors disabled:opacity-50";
  const on = "border-gold/60 bg-gold/10 text-gold";
  const off = "border-border text-text-3 hover:text-text";

  return (
    <div className="flex items-center gap-2 text-[11px] text-text-3" aria-live="polite">
      <span>{value ? "Thanks for the feedback" : "Was this helpful?"}</span>
      <button type="button" aria-label="Helpful" aria-pressed={value === "up"} disabled={busy} onClick={() => rate("up")} className={`${base} ${value === "up" ? on : off}`}>
        👍
      </button>
      <button type="button" aria-label="Not helpful" aria-pressed={value === "down"} disabled={busy} onClick={() => rate("down")} className={`${base} ${value === "down" ? on : off}`}>
        👎
      </button>
      {failed && <span className="text-danger">Could not save, try again.</span>}
    </div>
  );
}
