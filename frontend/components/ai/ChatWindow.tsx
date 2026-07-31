// components/ai/ChatWindow.tsx
// Sprint L2.4 - passes through streamingId (which bubble, if any, is still
// receiving real tokens) and the real onCopy/onRetry actions. Retry is only
// ever offered on the most recent assistant message. Empty state now
// guides toward two real actions instead of a flat "no messages" line.
"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { DisplayMessage } from "./MessageBubble";
import MessageBubble from "./MessageBubble";
import ThinkingIndicator from "./ThinkingIndicator";

interface Props {
  messages: DisplayMessage[];
  thinking: boolean;
  error?: string | null;
  streamingId?: string | null;
  onCopy: (content: string) => void;
  onRetry: () => void;
}

export default function ChatWindow({ messages, thinking, error, streamingId, onCopy, onRetry }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  if (messages.length === 0 && !thinking) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold text-text-2">Start your first conversation</p>
        <p className="max-w-sm text-xs text-text-3">
          Ask about trading concepts, strategies, or request a live analysis - try &ldquo;Ask about Gold&rdquo; or
          &ldquo;What&rsquo;s your outlook on EUR/USD?&rdquo;
        </p>
        <Link href="/dashboard/knowledge" className="text-xs font-medium text-gold hover:text-gold-strong">
          Upload knowledge first &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          isStreaming={m.id === streamingId}
          isLastAssistant={m.id === lastAssistantId}
          onCopy={onCopy}
          onRetry={onRetry}
        />
      ))}
      {thinking && <ThinkingIndicator />}
      {error && <p className="text-center text-xs text-danger">{error}</p>}
      <div ref={endRef} />
    </div>
  );
}
