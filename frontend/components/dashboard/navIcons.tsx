// components/dashboard/navIcons.tsx
// Both DashboardSidebar.tsx and MobileNav.tsx rendered DashboardNavItem's
// `icon` field (a 2-letter code like "DB"/"QT"/"MI") as literal monospace
// text - real navigation labels displayed as raw internal shorthand, not
// icons. One shared lookup here maps each existing code to a real
// lucide-react icon (already a dependency, used everywhere else in the
// app) so both surfaces render consistently. The `icon` field itself in
// dashboard.config.ts is untouched - existing validators
// (validate-p4.11-algo-testing-navigation.ts, validate-algo-test-walk-
// forward-ui.ts) assert its literal string value, and it remains a valid,
// stable key.
import {
  LayoutDashboard,
  Sigma,
  FlaskConical,
  Store,
  MessagesSquare,
  Signal,
  BarChart3,
  Newspaper,
  CalendarDays,
  BookOpen,
  Bot,
  Workflow,
  ListChecks,
  History,
  ClipboardList,
  LifeBuoy,
  Coins,
  ShoppingCart,
  KeyRound,
  Settings,
  ShieldCheck,
  Circle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const NAV_ICON_MAP: Record<string, LucideIcon> = {
  DB: LayoutDashboard,
  QT: Sigma,
  AT: FlaskConical,
  MK: Store,
  AI: MessagesSquare,
  SG: Signal,
  MI: BarChart3,
  NW: Newspaper,
  EC: CalendarDays,
  RS: BookOpen,
  AG: Bot,
  AU: Workflow,
  ST: ListChecks,
  BT: History,
  RE: ClipboardList,
  SP: LifeBuoy,
  CR: Coins,
  PU: ShoppingCart,
  LC: KeyRound,
  SE: Settings,
  AD: ShieldCheck,
};

// Falls back to a plain dot rather than raw text if a future nav item ever
// ships a code with no mapping yet - never re-exposes the internal code to
// the user.
export function NavIcon({ code, className }: { code: string; className?: string }) {
  const Icon = NAV_ICON_MAP[code] ?? Circle;
  return <Icon className={className} size={16} aria-hidden="true" />;
}
