// components/ai/ChatWindow.tsx
"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/types/message";
import MessageBubble from "./MessageBubble";
import ThinkingIndicator from "./ThinkingIndicator";

interface Props {
  messages: Message[];
  thinking: boolean;
  error?: string | null;
}

export default function ChatWindow({ messages, thinking, error }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {messages.length === 0 && !thinking && (
        <p className="mt-10 text-center text-sm text-slate-600">No messages yet. Start the conversation.</p>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {thinking && <ThinkingIndicator />}
      {error && <p className="text-center text-xs text-red-400">{error}</p>}
      <div ref={endRef} />
    </div>
  );
}