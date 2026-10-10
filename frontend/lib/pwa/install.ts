"use client";
// lib/pwa/install.ts
// Browser-side install state shared by the install banner and the device panel: the deferred "beforeinstallprompt" event
// (Chrome/Edge/Android), whether the app already runs installed (standalone), and the service worker registration.
// Everything is wrapped so a blocked storage / missing API never breaks the page.

type Listener = () => void;
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let started = false;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export function startInstallTracking(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function subscribeInstall(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const hasInstallPrompt = (): boolean => deferred !== null;
export const wasInstalledNow = (): boolean => installed;

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const d = deferred;
  deferred = null;
  emit();
  try {
    await d.prompt();
    return (await d.userChoice).outcome;
  } catch {
    return "dismissed";
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch {
    return null;
  }
}

export function readDismissedAt(): number | null {
  try {
    const v = window.localStorage.getItem("at24.installBannerDismissedAt");
    return v ? Number(v) || null : null;
  } catch {
    return null;
  }
}

export function writeDismissedAt(t: number): void {
  try {
    window.localStorage.setItem("at24.installBannerDismissedAt", String(t));
  } catch {
    // private mode / blocked storage: the banner will simply show again next visit
  }
}
