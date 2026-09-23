// config/dashboard.config.ts
// Sprint L2.3 - Removed 4 dead entries (Products, Downloads, Profile,
// Settings all pointed at routes that don't exist - confirmed via
// filesystem search, not assumption) and added Payments, a real route
// (app/dashboard/payments/page.tsx) that existed but had no navigation
// entry at all, making it undiscoverable. Every remaining href below was
// verified against the actual app/ directory.
// Sprint L2.5 - Removed the Payments entry: that page was a fully mock,
// orphaned duplicate of the real Billing dashboard's invoice history
// (different Invoice type, static data/invoices.ts, never wired to the
// real Plan/Subscription/Billing tables) - see the L2.5 audit. Invoices
// now live only in Billing, where they're real.
//
// Sprint IA1 - Backoffice Information Architecture refactor. The flat list
// above became unnavigable as the product surface grew (17 items, no
// grouping, no product boundaries visible). Replaced with the locked AT24
// IA: Dashboard, then five named groups (PRODUCTS / INTELLIGENCE /
// AUTOMATION / WORKSPACE / ACCOUNT), each holding top-level items that may
// carry `children` - a second, unlabeled nesting tier for real existing
// pages that don't have their own slot in the locked hierarchy but must
// stay reachable (no dead links, nothing deleted). Every href below was
// re-verified against the current app/ tree, not assumed from the old list.
// Full old-item -> new-location mapping and the reasoning behind each
// judgment call (Trading Copilot, Knowledge Base, Publishing, Billing,
// Orders, the Quant Lite/Pro split, the Workspace section) lives in
// docs/IA1-BACKOFFICE-NAVIGATION-REFACTOR.md.
//
// Sprint UI-01 - the `icon` field changed from a 2-letter placeholder
// string ("DB", "QT", ...) that the sidebar rendered as literal text to a
// real lucide-react icon component. Structure, grouping, order, labels and
// hrefs are all untouched - the locked IA is unchanged, only the glyph is
// now a real icon (required for the collapsed icon-rail).
import {
  LayoutDashboard,
  LineChart,
  FlaskConical,
  Store,
  Bot,
  Signal,
  Globe,
  Newspaper,
  CalendarDays,
  Microscope,
  Cpu,
  Workflow,
  FolderKanban,
  Activity,
  FileText,
  LifeBuoy,
  CreditCard,
  ShoppingBag,
  KeyRound,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";

export interface DashboardNavChild {
  label: string;
  href: string;
}

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  // Sprint L2.6 - only rendered for role === "admin" (see
  // DashboardSidebar.tsx); the real gate is still server-side
  // (requireRole in app/dashboard/admin/layout.tsx) - hiding the link is
  // just discoverability, never the actual authorization boundary.
  adminOnly?: boolean;
  // Sprint IA1 - a second, unlabeled nesting tier. Used for real existing
  // pages that are a sub-capability of the parent (e.g. Trading Copilot
  // and Knowledge Base under AI Assistant) rather than a distinct locked
  // top-level slot of their own.
  children?: DashboardNavChild[];
}

export interface DashboardNavGroup {
  // null = ungrouped (Dashboard at the top, Admin at the bottom) - rendered
  // with no section heading.
  label: string | null;
  items: DashboardNavItem[];
}

export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: null,
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "PRODUCTS",
    items: [
      {
        label: "Quant",
        // Sprint IA1 - had no umbrella page of its own yet, so this linked
        // straight to the free entry product (Quant Lite and Quant Pro
        // are, and stay, separate products/engines per the sprint's
        // explicit boundary).
        // Sprint IA2 - now a real umbrella landing page (app/quant/page.tsx)
        // that states the Lite/Pro boundary explicitly before routing to
        // either product, using the same feature lists /quant-lite/upgrade
        // already showed (data/quant-positioning.ts, one source of truth).
        href: "/quant",
        icon: LineChart,
        children: [
          { label: "Quant Lite", href: "/quant-lite" },
          // Quant Pro launched (Quant Chat, under Algo Testing Pro) -
          // /quant-lite/upgrade's "not yet available" framing is now
          // stale, so this link was repointed to the real product instead
          // of left dead. Not consolidated into a single nav entry with
          // Algo Testing Pro's own child link, to avoid a duplicate
          // "Quant Pro" label in the sidebar (see that item's own
          // comment) - this simply fixes it to go somewhere real.
          { label: "Quant Pro", href: "/dashboard/quant-chat" },
        ],
      },
      // Sprint IA1 - the at24-quant-engine integration (P3.x program) has
      // no standalone page: it's a toolbar/panel inside the Native Chart
      // workspace, scoped today to XAUUSD/M5. Links to that real surface
      // rather than inventing a dedicated page around it.
      // Owner decision (2026-09-23) - Run History/Strategy Library/Optimize/
      // Walk-Forward (P4.7-T2/P4.8-T3.4.2/P4.9-C.2/P4.11) removed from this
      // nav. Owner's stated reasoning: these surfaces have no real use for
      // this product's actual flow - a user generates/brings their own code
      // and tests it independently on their own platform, so AT24 doesn't
      // need to run/validate it internally. The underlying pages/routes are
      // untouched (still reachable by URL if ever needed again), only their
      // navigation entries are gone. Replaced with "My Product Listing" -
      // the REAL existing mechanism for "test your own code, then sell it"
      // that turned out to ALREADY EXIST, fully built, with simply no nav
      // entry anywhere (Sprint M9: app/marketplace/sell/SellClient.tsx, a
      // complete draft-creation form -> POST /api/private/marketplace/
      // listings; Sprint M12: app/marketplace/my-products, the seller
      // backoffice - price/media/screenshots + a real "Submit for review"
      // ingestion+eligibility pipeline, screenshots explicitly captioned
      // "strategy tester results" from the seller's own platform). Points
      // at /marketplace/sell (the actual creation entry point) - SellClient
      // itself redirects to /marketplace/my-products once a draft exists,
      // which is also reachable directly from Marketplace below.
      {
        label: "Algo Testing Pro",
        href: "/dashboard/workspace",
        icon: FlaskConical,
        // Quant Pro production launch - Quant Chat (QP-0->QP-5, the
        // natural-language AI strategy builder) is the other real surface
        // of the same Quant Pro product as this registry-strategy suite
        // (locked launch decision: one paid product, two surfaces, not two
        // separate customer-facing products). Nested here rather than
        // given its own top-level PRODUCTS slot or a second "Quant Pro"
        // nav entry - smallest change that makes it discoverable at all
        // (it previously had zero navigation links anywhere in the app).
        children: [
          { label: "Quant Chat", href: "/dashboard/quant-chat" },
          { label: "My Product Listing", href: "/marketplace/sell" },
        ],
      },
      {
        label: "Marketplace",
        href: "/marketplace",
        icon: Store,
        children: [
          // Sprint M12 - the seller backoffice existed with a working page
          // but no nav entry anywhere (undiscoverable except by typing the
          // URL). Nested here as the seller-side view of Marketplace, and
          // also surfaced under Algo Testing Pro above (own comment there).
          { label: "My Products", href: "/marketplace/my-products" },
        ],
      },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      {
        label: "AI Assistant",
        href: "/dashboard/assistant",
        icon: Bot,
        children: [
          // Trading Copilot is a real, distinct pre-existing page - not
          // the sprint's "contextual Copilot" concept. Nested rather than
          // given its own Intelligence slot, per the explicit instruction
          // not to duplicate Copilot as a separate permanent nav item.
          { label: "Trading Copilot", href: "/dashboard/trading-copilot" },
          // The RAG document store the Assistant is grounded on.
          { label: "Knowledge Base", href: "/dashboard/knowledge" },
        ],
      },
      { label: "AI Signals", href: "/dashboard/signals", icon: Signal },
      { label: "Market Intelligence", href: "/dashboard/market-intelligence", icon: Globe },
      { label: "AI News", href: "/dashboard/news", icon: Newspaper },
      // AN2 - the Economic Calendar AN1.7 deferred (it removed the old mock
      // "High Impact Economic Events" section with a note that calendar data
      // "needs its own future provider/contract/audit"). Real feed now, so
      // it earns a real slot next to AI News rather than a nested child.
      { label: "Economic Calendar", href: "/dashboard/calendar", icon: CalendarDays },
      // No standalone Research page exists (Sprint D2.4.A1 deliberately
      // redirected the marketing /platform/research page into Assistant,
      // since Research wasn't distinct content there). Inside the
      // backoffice, real per-symbol research evidence does exist - the
      // Workspace's own "Research" section - so this links straight to it
      // instead of duplicating that content on a second page.
      { label: "AI Research", href: "/dashboard/workspace#research", icon: Microscope },
      // The real A1-A15 Agent Framework run console. /dashboard/agents (the
      // older agent-builder scaffold) now redirects here, so the nav points
      // straight at it - one "AI Agents" destination, the framework itself.
      { label: "AI Agents", href: "/dashboard/agents/runs", icon: Cpu },
    ],
  },
  {
    label: "AUTOMATION",
    items: [
      {
        label: "Automations",
        href: "/dashboard/automation",
        icon: Workflow,
        children: [
          // Publishing (AI content drafting + a schedule/queue/calendar)
          // doesn't fit Products/Intelligence/Workspace/Account - it's
          // scheduled/orchestrated content generation, which is what this
          // section is for. Nested under Automations rather than given a
          // top-level slot the locked IA doesn't have room for.
          { label: "Publishing", href: "/dashboard/publishing" },
        ],
      },
    ],
  },
  {
    label: "WORKSPACE",
    items: [
      // Quant Lite has no per-account persistence for "my strategies" or
      // "my results" yet (documented gap, Q1.6 Part 11: "'Your Backtests'
      // as a persisted, per-account list does not exist"). These three
      // link to the closest real, honest equivalents rather than a
      // fabricated history feature:
      { label: "Strategies", href: "/quant-lite/builder", icon: FolderKanban },
      { label: "Backtests", href: "/quant-lite/backtest", icon: Activity },
      // Sprint IA2 - was temporarily mapped to the Strategy Library (a
      // fixed, unrelated sample set) since there was no real "my results"
      // surface at all. Now points at a real one: a per-browser recent-
      // runs list (services/quant-lite/recentRuns.ts) - honest given the
      // backend has no per-account job history to build a real one from.
      { label: "Results", href: "/quant-lite/results", icon: FileText },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      // Sprint CS1 - the Chat Support Agent console. An account-adjacent
      // "get help" surface, deliberately NOT nested under INTELLIGENCE /
      // "AI Agents" (that is the trading-agent framework console; the
      // Support Agent is strictly separate - CS1.2 D1). Its own route
      // (app/dashboard/support/page.tsx), backed by the same framework
      // runs API with agentType SUPPORT.
      { label: "Support", href: "/dashboard/support", icon: LifeBuoy },
      // No credit-metering system exists yet (product decision explicitly
      // deferred this sprint). This links to a real page that states that
      // status honestly rather than a fabricated balance/usage widget.
      { label: "Credits", href: "/dashboard/credits", icon: CreditCard },
      { label: "Purchases", href: "/dashboard/purchases", icon: ShoppingBag },
      { label: "Licenses", href: "/dashboard/licenses", icon: KeyRound },
      {
        label: "Settings",
        href: "/dashboard/settings",
        icon: Settings,
        children: [
          // Plan/subscription/invoice management - a settings concern,
          // and the locked ACCOUNT list has no separate slot for it.
          { label: "Billing", href: "/dashboard/billing" },
        ],
      },
    ],
  },
  {
    // Sprint IA1 - kept fully separate from the five locked customer-facing
    // groups above (the sprint's own IA is explicitly scoped as
    // "customer-facing"); unchanged admin-only behavior, still gated both
    // here (discoverability) and server-side (requireRole).
    label: null,
    items: [{ label: "Admin", href: "/dashboard/admin", icon: Shield, adminOnly: true }],
  },
];

// Sprint IA2 - real breadcrumb label for DashboardHeader, replacing the
// hardcoded literal "Dashboard" string every page previously showed. Walks
// the same nav data the sidebar renders (one source of truth for "what is
// this page called"), matching top-level items and their children first,
// then falling back to the longest href prefix for dynamic sub-routes
// (e.g. /dashboard/licenses/[licenseId]) that have no nav entry of their own.
export function getBreadcrumbLabel(pathname: string): string {
  const allItems = DASHBOARD_NAV_GROUPS.flatMap((group) =>
    group.items.flatMap((item) => [
      { label: item.label, href: item.href, parent: group.label },
      ...(item.children ?? []).map((child) => ({ label: child.label, href: child.href, parent: item.label })),
    ])
  );

  const exact = allItems.find((entry) => entry.href === pathname);
  if (exact) return exact.parent ? `${exact.parent} / ${exact.label}` : exact.label;

  const prefixMatches = allItems
    .filter((entry) => entry.href !== "/dashboard" && pathname.startsWith(`${entry.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  const prefix = prefixMatches[0];
  if (prefix) return prefix.parent ? `${prefix.parent} / ${prefix.label}` : prefix.label;

  return "Dashboard";
}
