// app/dashboard/assistant/page.tsx
"use client";

import { useMemo, useState } from "react";
import type { Message } from "@/types/message";
import type { ConversationSummary } from "@/types/conversation";
import { getConversationSummaries, getConversationById } from "@/services/ai/conversation.service";
import { createUserMessage, sendMessage } from "@/services/ai/assistant.service";
import ConversationSidebar from "@/components/ai/ConversationSidebar";
import ChatWindow from "@/components/ai/ChatWindow";
import ChatInput from "@/components/ai/ChatInput";
import PromptSuggestions from "@/components/ai/PromptSuggestions";

const GREETING: Message = {
  id: "greet",
  role: "assistant",
  content: "Hi, I'm the Algotraders24 AI Strategy Assistant. Ask me to analyze a market, explain a concept, or build a strategy.",
  createdAt: new Date().toISOString(),
};

export default function AssistantPage() {
  const summaries: ConversationSummary[] = useMemo(() => getConversationSummaries(), []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [thinking, setThinking] = useState(false);

  const loadConversation = (id: string) => {
    const conv = getConversationById(id);
    setActiveId(id);
    setMessages(conv ? conv.messages : [GREETING]);
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([GREETING]);
  };

  const handleSend = async (text: string) => {
    const userMsg = createUserMessage(text);
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    const res = await sendMessage({
      conversationId: activeId ?? "new",
      message: text,
    });

    setThinking(false);
    setMessages((prev) => [...prev, res.message]);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      <ConversationSidebar
        conversations={summaries}
        activeId={activeId}
        onSelect={loadConversation}
        onNew={newChat}
      />

      <div className="flex flex-1 flex-col">
        <header className="border-b border-slate-800 px-4 py-3">
          <h1 className="text-lg font-bold">AI Strategy Assistant</h1>
          <p className="text-xs text-slate-500">Mock provider · no external AI</p>
        </header>

        <ChatWindow messages={messages} thinking={thinking} />

        <div className="px-4 py-2">
          <PromptSuggestions onPick={handleSend} />
        </div>

        <ChatInput onSend={handleSend} disabled={thinking} />
      </div>
    </div>
  );
}