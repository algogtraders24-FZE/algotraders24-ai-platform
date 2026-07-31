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
import { signOutAction } from "@/app/(auth)/actions/auth.actions";
import Dropdown from "@/components/ui/Dropdown";

export default function DashboardHeader({ userName }: { userName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="text-sm text-text-3">Dashboard</div>
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
