"use client";
// components/ui/Modal.tsx
// Sprint D1.0 - One modal shell. FeedbackWidget hand-rolled its own overlay
// + panel markup; this is that same shape, generalized and given real
// dialog semantics (role="dialog", aria-modal, Escape-to-close, focus
// returned to nothing exotic - the trigger already has it since the panel
// unmounts) so future modals don't each reinvent it slightly differently.
import { useEffect } from "react";
import type { ReactNode } from "react";

export default function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/50 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-panel border border-border bg-ink-2 p-6 text-text shadow-overlay"
      >
        <div className="flex items-center justify-between">
          <h2 id="modal-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-3 transition hover:text-text">
            &times;
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
