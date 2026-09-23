"use client";

// components/shell/NotificationBell.tsx
// Sprint UI-01 - the Topbar notifications slot. There is no notification
// service yet, so this shows a real, honest empty state rather than a fake
// unread badge or invented items. The trigger + popover shell is the
// reusable part: a real notification feed drops into this panel later
// without the Topbar changing.
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-control border border-border text-text-2 transition hover:border-gold/40 hover:text-text"
      >
        <Bell size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-border bg-ink-2 shadow-floating"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-text">Notifications</p>
          </div>
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-text-2">You&apos;re all caught up</p>
            <p className="mt-1 text-xs text-text-3">Alerts about your account, analyses and runs will appear here.</p>
          </div>
        </div>
      )}
    </div>
  );
}
