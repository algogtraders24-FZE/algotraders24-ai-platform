"use client";
// components/ui/InfoTooltip.tsx
// Sprint R1.1 - Small reusable "what does this mean" affordance for product
// guidance (Confidence, Risk, Evidence, etc.). Click-to-toggle rather than
// hover-only so it works on touch devices, closes on outside click/Escape.
import { useEffect, useRef, useState } from "react";

export default function InfoTooltip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`What does ${label} mean?`}
        className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold leading-none text-text-3 opacity-70 transition hover:opacity-100"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-card border border-border bg-ink-2 p-3 text-left text-xs font-normal normal-case leading-5 tracking-normal text-text-2 shadow-floating"
        >
          {text}
        </span>
      )}
    </span>
  );
}
