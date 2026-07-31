// components/ai/ChatInput.tsx
// Sprint L2.4 - while a response is actually generating, the Send button
// becomes a real Stop button wired to the in-flight AbortController (see
// app/dashboard/assistant/page.tsx's handleStop) - not a disabled/decorative
// state.
"use client";

import { useState } from "react";

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isGenerating: boolean;
}

export default function ChatInput({ onSend, onStop, isGenerating }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask about a market, concept, or strategy..."
        className="flex-1 resize-none rounded-xl border border-border bg-ink px-3 py-2.5 text-sm text-text outline-none focus:border-gold/50"
      />
      {isGenerating ? (
        <button
          onClick={onStop}
          className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text transition hover:border-danger/50 hover:text-danger"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Send
        </button>
      )}
    </div>
  );
}
