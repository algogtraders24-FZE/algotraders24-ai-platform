"use client";

// components/dashboard/MobileNav.tsx
// Sprint D2.3 (Phase 3) - fixes the critical audit finding: the dashboard
// sidebar is `hidden md:block`, so on < md there was NO way to navigate
// between modules. This adds a hamburger + slide-in drawer (mobile only) that
// mirrors the exact same DASHBOARD_NAV, active-state, and admin-only filtering
// as DashboardSidebar - one nav source of truth, two responsive presentations.
// Closes on navigation, on overlay tap, and on Escape; locks body scroll while
// open; respects the token system.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { DASHBOARD_NAV } from "@/config/dashboard.config";
import { useUserContext } from "@/context/UserContext";
import BrandLogo from "@/components/brand/BrandLogo";

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { user } = useUserContext();
  const items = DASHBOARD_NAV.filter((item) => !item.adminOnly || user?.role === "admin");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="dashboard-mobile-nav"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-control border border-border text-text transition-colors hover:border-gold"
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div
            id="dashboard-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-ink-2 p-4"
          >
            <div className="flex items-center justify-between">
              <Link href="/" aria-label="Algotraders24 AI home" onClick={() => setOpen(false)}>
                <BrandLogo variant="full" size="sm" />
              </Link>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-control text-text-2 transition-colors hover:text-text"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <nav className="mt-6 space-y-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-control px-3 py-2.5 text-sm transition ${
                    pathname === item.href ? "bg-gold/10 text-gold" : "text-text-2 hover:bg-ink-3 hover:text-text"
                  }`}
                >
                  <span className="font-mono text-xs text-text-3">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
