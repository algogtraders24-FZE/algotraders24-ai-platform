// components/ai/PromptSuggestions.tsx
"use client";

import { promptSuggestions } from "@/data/mock-prompts";
import { EDUCATIONAL_TERMS } from "@/data/educational-terms";
import InfoTooltip from "@/components/ui/InfoTooltip";

export default function PromptSuggestions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {promptSuggestions.map((s) => {
        // Sprint D2.3.S4 - optional educational tooltip when a suggestion's
        // label names a defined term (e.g. "Order Blocks" -> "order block").
        const term = EDUCATIONAL_TERMS[s.label.toLowerCase().replace(/s$/, "")];
        return (
          <span
            key={s.id}
            className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs text-text-2 transition hover:border-gold/40 hover:text-gold-strong"
          >
            <button onClick={() => onPick(s.prompt)}>{s.label}</button>
            {term && <InfoTooltip label={s.label} text={term.definition} />}
          </span>
        );
      })}
    </div>
  );
}