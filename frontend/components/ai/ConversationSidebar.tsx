// components/ai/ConversationSidebar.tsx
"use client";

import type { ConversationSummary } from "@/types/conversation";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export default function ConversationSidebar({ conversations, activeId, onSelect, onNew }: Props) {
  return (
    <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-950">
      <button
        onClick={onNew}
        className="m-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
      >
        + New Chat
      </button>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition ${
              c.id === activeId
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-900"
            }`}
          >
            {c.title}
          </button>
        ))}
      </nav>
    </aside>
  );
}