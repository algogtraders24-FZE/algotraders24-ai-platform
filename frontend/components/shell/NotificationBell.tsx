"use client";

// components/shell/NotificationBell.tsx
// The Topbar notifications bell. Reads the real in-app feed (/api/private/notifications): an unread badge,
// the newest items, and "Mark all read". First producer: Live Sync alerts. Shows an honest empty state when
// there is nothing (or when the feed is not available), never invented items.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

interface Item {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical" | string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  readAt: string | null;
}

const POLL_MS = 60_000;

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/private/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setItems((j.data.items as Item[]) ?? []);
      setUnread(Number(j.data.unread) || 0);
    } catch {
      // The bell stays quiet if the feed cannot be read.
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  async function readAll() {
    try {
      await fetch("/api/private/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read_all" }) });
    } finally {
      await load();
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-control border border-border text-text-2 transition hover:border-gold/40 hover:text-text"
      >
        <Bell size={16} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-border bg-ink-2 shadow-floating"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-text">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => void readAll()} className="text-xs font-semibold text-gold hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-text-2">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-text-3">Alerts about your accounts, analyses and runs will appear here.</p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {items.map((n) => {
                const dot = n.severity === "critical" ? "bg-red-500" : n.severity === "warning" ? "bg-amber-400" : "bg-sky-400";
                const inner = (
                  <div className={`flex gap-3 px-4 py-3 ${n.readAt ? "opacity-70" : ""}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-text">{n.title}</p>
                      {n.body && <p className="text-xs text-text-2">{n.body}</p>}
                      <p className="text-[11px] text-text-3">{ago(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link href={n.href} onClick={() => setOpen(false)} className="block hover:bg-white/[0.03]">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
