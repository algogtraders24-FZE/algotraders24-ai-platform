// components/ai/ConversationSidebar.tsx
// Sprint L2.4 - added a real relative timestamp per conversation
// (StoredConversation.updatedAt already existed, just wasn't shown).
// Active-conversation highlight and sorting were already real; unchanged.
"use client";

import { useState } from "react";
import type { StoredConversation } from "@/types/conversation-metadata";

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

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
    <aside className="flex w-64 flex-col border-r border-border bg-ink">
      <button onClick={onNew} className="m-3 rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-ink hover:brightness-110">
        + New Chat
      </button>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search..."
        className="mx-3 mb-2 rounded-lg border border-border bg-ink-2 px-3 py-1.5 text-sm text-text outline-none focus:border-gold/50"
      />

      <button onClick={() => setShowArchived((v) => !v)} className="mx-3 mb-2 text-left text-xs text-text-3 hover:text-text-2">
        {showArchived ? "← Back to chats" : "View archived"}
      </button>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`group rounded-lg px-3 py-2 text-sm transition ${
              c.id === activeId ? "bg-ink-3 text-text" : "text-text-2 hover:bg-ink-2"
            }`}
          >
            <div className="flex items-center gap-2">
              <button onClick={() => onSelect(c.id)} className="flex-1 truncate text-left">
                {c.pinned ? "📌 " : ""}{c.title}
              </button>
              <span className="shrink-0 text-[10px] text-text-3">{formatRelativeTime(c.updatedAt)}</span>
            </div>
            <div className="mt-1 hidden gap-2 text-[10px] text-text-3 group-hover:flex">
              <button onClick={() => onRename(c.id, prompt("Rename:", c.title) ?? c.title)} className="hover:text-text">Rename</button>
              <button onClick={() => onPin(c.id, !c.pinned)} className="hover:text-text">{c.pinned ? "Unpin" : "Pin"}</button>
              <button onClick={() => onArchive(c.id, !c.archived)} className="hover:text-text">{c.archived ? "Restore" : "Archive"}</button>
              <button onClick={() => onDelete(c.id)} className="hover:text-danger">Delete</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="px-3 text-xs text-text-3">No conversations.</p>}
      </nav>
    </aside>
  );
}