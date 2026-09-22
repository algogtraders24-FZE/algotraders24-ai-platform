"use client";
// components/ui/Drawer.tsx
// Sprint UI-01 - Side-sheet primitive. Same job as Modal (overlay + dialog
// semantics: role="dialog", aria-modal, Escape-to-close, body-scroll lock,
// click-outside) but slides in from an edge instead of centering. Used for
// the mobile navigation drawer and, later, filter/detail panels that a
// centered modal would fit badly.
import { useEffect } from "react";
import type { ReactNode } from "react";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. Rendered as a heading when `title` is a
   *  string; pass a node for a custom header row (e.g. logo + close). */
  title: ReactNode;
  /** Visually hide the default header (when the caller renders its own). */
  hideHeader?: boolean;
  side?: "left" | "right";
  /** Tailwind width class for the panel. */
  widthClassName?: string;
  children: ReactNode;
}

export default function Drawer({
  open,
  onClose,
  title,
  hideHeader = false,
  side = "left",
  widthClassName = "w-72 max-w-[85vw]",
  children,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={[
          "absolute inset-y-0 flex flex-col overflow-y-auto border-border bg-ink-2 shadow-overlay",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          widthClassName,
        ].join(" ")}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            {typeof title === "string" ? <h2 className="text-sm font-semibold text-text">{title}</h2> : title}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-control p-1 text-text-3 transition hover:text-text"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
