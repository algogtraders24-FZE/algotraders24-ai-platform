// components/ai/ConversationSidebar.tsx
"use client";

import { useState } from "react";
import type { StoredConversation } from "@/types/conversation-metadata";

interface Props {
  conversations: StoredConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
}

export default function ConversationSidebar({
  conversations, activeId, onSelect, onNew, onRename, onDelete, onPin, onArchive,
}: Props) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const filtered = conversations.filter(
    (c) => c.archived === showArchived && c.title.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-950">
      <button onClick={onNew} className="m-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
        + New Chat
      </button>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search..."
        className="mx-3 mb-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
      />

      <button onClick={() => setShowArchived((v) => !v)} className="mx-3 mb-2 text-left text-xs text-slate-500 hover:text-slate-300">
        {showArchived ? "← Back to chats" : "View archived"}
      </button>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`group rounded-lg px-3 py-2 text-sm transition ${
              c.id === activeId ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-900"
            }`}
          >
            <div className="flex items-center gap-2">
              <button onClick={() => onSelect(c.id)} className="flex-1 truncate text-left">
                {c.pinned ? "📌 " : ""}{c.title}
              </button>
            </div>
            <div className="mt-1 hidden gap-2 text-[10px] text-slate-500 group-hover:flex">
              <button onClick={() => onRename(c.id, prompt("Rename:", c.title) ?? c.title)} className="hover:text-slate-200">Rename</button>
              <button onClick={() => onPin(c.id, !c.pinned)} className="hover:text-slate-200">{c.pinned ? "Unpin" : "Pin"}</button>
              <button onClick={() => onArchive(c.id, !c.archived)} className="hover:text-slate-200">{c.archived ? "Restore" : "Archive"}</button>
              <button onClick={() => onDelete(c.id)} className="hover:text-red-400">Delete</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="px-3 text-xs text-slate-600">No conversations.</p>}
      </nav>
    </aside>
  );
}