"use client";
// components/ui/Toast.tsx
// Sprint D1.0 - The one toast system for the platform (none existed before
// this sprint - every action result was an inline banner that stayed in
// the page's flow). Mounted once at the root (app/layout.tsx) via
// ToastProvider; call useToast().push(...) from any client component.
// Auto-dismisses; screen readers get it via aria-live rather than focus
// theft, so it never interrupts what the user was doing.
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { AlertTone } from "./Alert";

interface ToastEntry {
  id: number;
  tone: AlertTone;
  message: string;
}

interface ToastContextValue {
  push: (message: string, tone?: AlertTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASSES: Record<AlertTone, string> = {
  success: "border-success/30 bg-ink-2 text-success",
  warning: "border-warning/30 bg-ink-2 text-warning",
  danger: "border-danger/30 bg-ink-2 text-danger",
  info: "border-info/30 bg-ink-2 text-info",
};

let nextId = 1;
const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const push = useCallback((message: string, tone: AlertTone = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-6 sm:translate-x-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={["pointer-events-auto rounded-card border px-4 py-3 text-sm shadow-floating", TONE_CLASSES[t.tone]].join(" ")}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
