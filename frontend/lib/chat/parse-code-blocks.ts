// lib/chat/parse-code-blocks.ts
// Quant Chat "Ask AI Anything" - splits a chat message's raw text into
// alternating text/code segments so MessageBubble can render a fenced
// ```lang ... ``` block as a proper CodeBlock (Copy/Download) instead of
// literal backticks in a whitespace-pre-wrap <div>. Deliberately NOT a full
// Markdown renderer (no lists/bold/links/tables) - this codebase has no
// Markdown dependency yet and every other AI surface today is plain text;
// code fences are the one shape that is unreadable left as raw text.
// An unterminated trailing fence (mid-stream, before the closing ``` has
// arrived yet) is left as plain text rather than guessed-closed - it
// re-parses correctly once the stream finishes and the fence closes.
export interface TextSegment {
  readonly type: "text";
  readonly content: string;
}

export interface CodeSegment {
  readonly type: "code";
  readonly language: string;
  readonly code: string;
}

export type MessageSegment = TextSegment | CodeSegment;

const FENCE_PATTERN = /```([\w+-]*)\n([\s\S]*?)```/g;

export function parseMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  FENCE_PATTERN.lastIndex = 0;
  while ((match = FENCE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", language: match[1]?.trim() || "text", code: match[2] ?? "" });
    lastIndex = FENCE_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", content: text }];
}
