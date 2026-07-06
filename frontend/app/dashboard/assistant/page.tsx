"use client";

import { useEffect, useState } from "react";
import type { StoredConversation } from "@/types/conversation-metadata";
import { createUserMessage, sendMessage } from "@/services/ai/assistant.service";
import * as mgr from "@/services/ai/conversation-manager.service";
import ConversationSidebar from "@/components/ai/ConversationSidebar";
import ChatWindow from "@/components/ai/ChatWindow";
import ChatInput from "@/components/ai/ChatInput";
import PromptSuggestions from "@/components/ai/PromptSuggestions";

export default function AssistantPage() {
  const [list, setList] = useState<StoredConversation[]>([]);
  const [active, setActive] = useState<StoredConversation | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setList(await mgr.loadRecent());

  useEffect(() => {
    (async () => {
      await refresh();
      const id = await mgr.selectedId.get();
      const all = await mgr.loadRecent();
      setActive(all.find((c) => c.id === id) ?? all[0] ?? null);
    })();
  }, []);

  const select = async (id: string) => {
    const conv = list.find((c) => c.id === id) ?? null;
    setActive(conv);
    await mgr.selectedId.set(id);
  };

  const newChat = async () => {
    const conv = await mgr.createConversation();
    await mgr.selectedId.set(conv.id);
    setActive(conv);
    await refresh();
  };

  const handleSend = async (text: string) => {
    setError(null);
    let conv = active ?? (await mgr.createConversation());
    conv = await mgr.addMessage(conv, createUserMessage(text));
    setActive(conv);
    await refresh();
    setThinking(true);
    try {
      const res = await sendMessage({ conversationId: conv.id, message: text });
      conv = await mgr.addMessage(conv, res.message);
      setActive(conv);
      await refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-2rem)] overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100">
      <ConversationSidebar
        conversations={list}
        activeId={active?.id ?? null}
        onSelect={select}
        onNew={newChat}
        onRename={async (id, title) => { const c = list.find((x) => x.id === id); if (c) { await mgr.rename(c, title); await refresh(); } }}
        onDelete={async (id) => { await mgr.deleteConversation(id); if (active?.id === id) setActive(null); await refresh(); }}
        onPin={async (id, p) => { const c = list.find((x) => x.id === id); if (c) { await mgr.setPinned(c, p); await refresh(); } }}
        onArchive={async (id, a) => { const c = list.find((x) => x.id === id); if (c) { await mgr.setArchived(c, a); await refresh(); } }}
      />

      <div className="flex flex-1 flex-col">
        <header className="border-b border-slate-800 px-4 py-3">
          <h1 className="text-lg font-bold">AI Strategy Assistant</h1>
          <p className="text-xs text-slate-500">Persistent - Gemini 2.5 Flash</p>
        </header>

        <ChatWindow messages={active?.messages ?? []} thinking={thinking} error={error} />

        <div className="px-4 py-2">
          <PromptSuggestions onPick={handleSend} />
        </div>

        <ChatInput onSend={handleSend} disabled={thinking} />
      </div>
    </div>
  );
}
