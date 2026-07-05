// components/ai/PromptSuggestions.tsx
"use client";

import { promptSuggestions } from "@/data/mock-prompts";

export default function PromptSuggestions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {promptSuggestions.map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s.prompt)}
          className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500/40 hover:text-indigo-300"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}