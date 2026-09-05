"use client";

// Sprint R1.1 - Sign out moved here from app/dashboard/page.tsx so it's
// reachable from every dashboard page.
// Sprint D1.0 - Retrofitted onto the token system (bg-[...]/border-
// [#1F2937]/blue-purple gradient avatar -> ink/gold), and the previously
// decorative avatar is now a real account menu (components/ui/Dropdown) -
// the first real application of that new primitive. Calling the
// signOutAction server action directly from a client onSelect handler
// (rather than only via a <form action>) is a supported Next.js pattern;
// its internal redirect() still runs the same as before.
// Sprint IA2 - the breadcrumb label is now real (getBreadcrumbLabel reads
// the same DASHBOARD_NAV_GROUPS data the sidebar renders), replacing the
// hardcoded literal "Dashboard" that every single page previously showed.
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions/auth.actions";
import { getBreadcrumbLabel } from "@/config/dashboard.config";
import Dropdown from "@/components/ui/Dropdown";
import MobileNav from "@/components/dashboard/MobileNav";

export default function DashboardHeader({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      {/* Sprint D2.3 (P3): MobileNav is the only dashboard navigation on < md,
          where the sidebar is hidden. It sits before the breadcrumb label. */}
      <div className="flex items-center gap-3">
        <MobileNav />
        <span className="text-sm text-text-3">{getBreadcrumbLabel(pathname)}</span>
      </div>
      <Dropdown
        trigger={
          <span className="flex items-center gap-3">
            <span className="text-sm text-text-2">{userName}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 font-bold text-gold">
              {userName.charAt(0)}
            </span>
          </span>
        }
        items={[{ label: "Sign out", tone: "danger", onSelect: () => void signOutAction() }]}
      />
    </header>
  );
}
