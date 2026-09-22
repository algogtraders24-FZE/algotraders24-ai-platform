"use client";

// components/shell/SidebarContext.tsx
// Sprint UI-01 - AT24 Premium UI Foundation. One source of truth for the
// AppShell's sidebar state, shared by Sidebar (desktop rail), Topbar (the
// collapse toggle + mobile hamburger) and the mobile Drawer.
//
// Collapse rules (approved UI-01 sign-off):
//   - A stored preference (localStorage "at24:sidebar:collapsed") always wins
//     and is what the toggle writes.
//   - With no stored preference, the rail follows the viewport: collapsed
//     below 1280px, expanded at/above it, and it keeps following on resize
//     until the user makes an explicit choice.
// SSR renders expanded (the desktop default) to keep markup deterministic;
// the real state is applied on mount, and `ready` gates the width transition
// so there's no first-paint slide.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "at24:sidebar:collapsed";
const COLLAPSE_BELOW = 1280;

interface SidebarState {
  /** Desktop rail is icon-only. */
  collapsed: boolean;
  /** Mobile (< md) slide-in drawer is open. */
  mobileOpen: boolean;
  /** True once the mount-time state has been applied - used to suppress the
   *  width transition on first paint. */
  ready: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (value: boolean) => void;
  openMobile: () => void;
  closeMobile: () => void;
}

const SidebarCtx = createContext<SidebarState | null>(null);

function readStoredPreference(): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // Private mode / storage disabled - fall through to the viewport rule.
  }
  return null;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // Stays false until the user makes an explicit choice this session or a
  // stored preference is found; while false, resize keeps steering the rail.
  const hasExplicitPref = useRef(false);

  useEffect(() => {
    const stored = readStoredPreference();
    if (stored !== null) {
      hasExplicitPref.current = true;
      setCollapsedState(stored);
    } else {
      setCollapsedState(window.innerWidth < COLLAPSE_BELOW);
    }
    setReady(true);

    const onResize = () => {
      if (hasExplicitPref.current) return;
      setCollapsedState(window.innerWidth < COLLAPSE_BELOW);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const persist = useCallback((value: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Non-fatal - the choice still applies for this session.
    }
  }, []);

  const setCollapsed = useCallback(
    (value: boolean) => {
      hasExplicitPref.current = true;
      setCollapsedState(value);
      persist(value);
    },
    [persist],
  );

  const toggleCollapsed = useCallback(() => {
    hasExplicitPref.current = true;
    setCollapsedState((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, [persist]);

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <SidebarCtx.Provider
      value={{ collapsed, mobileOpen, ready, toggleCollapsed, setCollapsed, openMobile, closeMobile }}
    >
      {children}
    </SidebarCtx.Provider>
  );
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarCtx);
  if (!ctx) throw new Error("useSidebar must be used within <SidebarProvider>");
  return ctx;
}
