// Sprint R1.1 - Sign out moved here from app/dashboard/page.tsx so it's
// reachable from every dashboard page, not just the home page (previously
// the only sign-out control on the whole dashboard lived on /dashboard
// itself - navigating anywhere else left a user with no way to sign out).
// "Welcome back" (a static, page-content greeting that doesn't belong in a
// persistent header) is dropped in favor of a neutral section label.
import { signOutAction } from "@/app/(auth)/actions/auth.actions";

export default function DashboardHeader({ userName }: { userName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-[#1F2937] px-6 py-4">
      <div className="text-sm text-gray-400">Dashboard</div>
      <div className="flex items-center gap-4">
        <span className="text-sm">{userName}</span>
        <div className="w-9 h-9 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center font-bold">
          {userName.charAt(0)}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}