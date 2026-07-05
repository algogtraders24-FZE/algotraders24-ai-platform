// components/ai/MessageBubble.tsx
import type { Message } from "@/types/message";

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-indigo-600 text-white"
            : "border border-slate-800 bg-slate-900/60 text-slate-200"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}