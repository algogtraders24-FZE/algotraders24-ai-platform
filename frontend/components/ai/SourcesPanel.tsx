// components/ai/SourcesPanel.tsx
// Sprint L2.4 - Real retrieved-chunk citations: document, chunk, and
// similarity all come straight from the chat route's real vector search
// (app/api/private/knowledge/chat/route.ts) - never invented. Rendered
// only when sources.length > 0; an assistant reply with no RAG grounding
// simply shows no panel, rather than an empty or fabricated one.
import type { ChatSource } from "@/services/ai/assistant.service";

export default function SourcesPanel({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-border bg-ink p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-3">
        Sources ({sources.length})
      </p>
      <ul className="space-y-2">
        {sources.map((s) => (
          <li key={s.chunkId} className="text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-medium text-text-2">{s.title}</span>
              <span className="shrink-0 font-mono text-text-3">{Math.round(s.similarity * 100)}% match</span>
            </div>
            <p className="mt-0.5 truncate text-text-3">
              chunk #{s.chunkIndex} · {s.snippet}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
