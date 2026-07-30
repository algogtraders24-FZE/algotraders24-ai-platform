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
    <div className="flex items-end gap-2 border-t border-slate-800 p-3">
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
        className="flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
      />
      {isGenerating ? (
        <button
          onClick={onStop}
          className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-red-500/50 hover:text-red-300"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          Send
        </button>
      )}
    </div>
  );
}
