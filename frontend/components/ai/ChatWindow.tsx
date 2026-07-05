// components/ai/ChatWindow.tsx
"use client";

import type { Message } from "@/types/message";
import MessageBubble from "./MessageBubble";
import ThinkingIndicator from "./ThinkingIndicator";

interface Props {
  messages: Message[];
  thinking: boolean;
}

export default function ChatWindow({ messages, thinking }: Props) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {thinking && <ThinkingIndicator />}
    </div>
  );
}