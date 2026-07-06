// components/ai/MessageBubble.tsx
import type { Message } from "@/types/message";

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
            isUser ? "bg-indigo-600 text-white" : "border border-slate-800 bg-slate-900/60 text-slate-200"
          }`}
        >
          {message.content}
        </div>
        <p className={`mt-1 text-[10px] text-slate-600 ${isUser ? "text-right" : "text-left"}`}>{time}</p>
      </div>
    </div>
  );
}