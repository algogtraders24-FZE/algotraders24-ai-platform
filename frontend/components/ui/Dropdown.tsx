"use client";
// components/ui/Dropdown.tsx
// Sprint D1.0 - One menu primitive. No dropdown/menu component existed
// anywhere before this sprint (every "actions" column was a row of
// separate buttons); this is the first, applied to DashboardHeader's
// previously-decorative avatar to give it a real account menu.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
}

export default function Dropdown({ trigger, items }: { trigger: ReactNode; items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-control">
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-44 overflow-hidden rounded-card border border-border bg-ink-2 py-1 shadow-floating"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={[
                "block w-full px-3 py-2 text-left text-sm transition",
                item.tone === "danger" ? "text-danger hover:bg-danger/10" : "text-text-2 hover:bg-ink-3 hover:text-text",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
