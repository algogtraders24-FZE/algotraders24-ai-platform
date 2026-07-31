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
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-2 transition hover:border-gold/40 hover:text-gold-strong"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}