"use client";

// components/ai/ThinkingIndicator.tsx
// Sprint D2.3.S2 - two real, honest additions to the plain dots (Master
// Audit D2.3.F: 60+ second waits with no feedback at all):
//   - `label`: a real stage name forwarded from the streaming chat route's
//     NDJSON "stage" events (see assistant.service.ts's onStage), never a
//     fabricated progress description.
//   - `showElapsed`: the market-analysis path (/api/private/market-intelligence
//     /analyze) is a single blocking call with no intermediate events to
//     report honestly - rather than invent fake stages for it, this shows
//     real ticking elapsed seconds instead, which is truthful and still
//     answers "is this actually still working?".
import { useEffect, useState } from "react";

interface Props {
  speed?: number;
  label?: string | null;
  showElapsed?: boolean;
}

export default function ThinkingIndicator({ speed = 1, label, showElapsed = false }: Props) {
  const dur = `${1 / speed}s`;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!showElapsed) return;
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [showElapsed]);

  const text = showElapsed ? `${label ?? "Analyzing"}… ${elapsedSeconds}s` : label;

  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-ink-2 px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-bounce rounded-full bg-ink-4"
              style={{ animationDuration: dur, animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        {text && <span className="text-xs text-text-3">{text}</span>}
      </div>
    </div>
  );
}
