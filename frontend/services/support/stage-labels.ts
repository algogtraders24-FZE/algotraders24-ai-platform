// services/support/stage-labels.ts
// Plain-language progress line for one step of a SUPPORT run (pure, shared by the stream route
// and the client). Falls back to a generic line, never throws.
export interface RunTimelineItem {
  index: number;
  kind: string;
  status: string;
  summary: string;
}

export function supportStageLabel(item: Pick<RunTimelineItem, "kind" | "summary">): string {
  const s = item.summary.toLowerCase();
  if (item.kind === "tool_call") {
    if (s.includes("account_read")) return "Checking your account status…";
    if (s.includes("knowledge_search")) return "Searching the knowledge base…";
    return "Looking this up…";
  }
  if (item.kind === "output") return "Writing the answer…";
  if (item.kind === "evaluation") return "Double-checking…";
  return "Thinking…";
}

/** Split an NDJSON text buffer into complete lines and the unfinished remainder. */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim().length > 0), rest };
}
