// app/dashboard/assistant/page.tsx
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
      setError("Something went wrong. Try