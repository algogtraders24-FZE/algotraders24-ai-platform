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
export interface DashboardNavChild {
  label: string;
  href: string;
}

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: string;
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
    items: [{ label: "Dashboard", href: "/dashboard", icon: "DB" }],
  },
  {
    label: "PRODUCTS",
    items: [
      {
        label: "Quant",
        // Sprint IA1 - the umbrella has no page of its own (Quant Lite and
        // Quant Pro are, and stay, separate products/engines per the
        // sprint's explicit boundary); it links to the free entry product.
        href: "/quant-lite",
        icon: "QT",
        children: [
          { label: "Quant Lite", href: "/quant-lite" },
          // Quant Pro has no built product yet - /quant-lite/upgrade is
          // the existing, honest "not yet available" comparison page
          // (Sprint Q0.8), not a fabricated placeholder.
          { label: "Quant Pro", href: "/quant-lite/upgrade" },
        ],
      },
      // Sprint IA1 - the at24-quant-engine integration (P3.x program) has
      // no standalone page: it's a toolbar/panel inside the Native Chart
      // workspace, scoped today to XAUUSD/M5. Links to that real surface
      // rather than inventing a dedicated page around it.
      { label: "Algo Testing Pro", href: "/dashboard/workspace", icon: "AT" },
      {
        label: "Marketplace",
        href: "/marketplace",
        icon: "MK",
        children: [
          // Sprint M12 - the seller backoffice existed with a working page
          // but no nav entry anywhere (undiscoverable except by typing the
          // URL). Nested here as the seller-side view of Marketplace.
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
        icon: "AI",
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
      { label: "AI Signals", href: "/dashboard/signals", icon: "SG" },
      { label: "Market Intelligence", href: "/dashboard/market-intelligence", icon: "MI" },
      { label: "AI News", href: "/dashboard/news", icon: "NW" },
      // No standalone Research page exists (Sprint D2.4.A1 deliberately
      // redirected the marketing /platform/research page into Assistant,
      // since Research wasn't distinct content there). Inside the
      // backoffice, real per-symbol research evidence does exist - the
      // Workspace's own "Research" section - so this links straight to it
      // instead of duplicating that content on a second page.
      { label: "AI Research", href: "/dashboard/workspace#research", icon: "RS" },
      { label: "AI Agents", href: "/dashboard/agents", icon: "AG" },
    ],
  },
  {
    label: "AUTOMATION",
    items: [
      {
        label: "Automations",
        href: "/dashboard/automation",
        icon: "AU",
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
      { label: "Strategies", href: "/quant-lite/builder", icon: "ST" },
      { label: "Backtests", href: "/quant-lite/backtest", icon: "BT" },
      // The Strategy Library - a fixed, evidence-style set of backtest
      // results; it already discloses its own fixed/legacy nature on-page.
      { label: "Results", href: "/quant-lite/library", icon: "RE" },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      // No credit-metering system exists yet (product decision explicitly
      // deferred this sprint). This links to a real page that states that
      // status honestly rather than a fabricated balance/usage widget.
      { label: "Credits", href: "/dashboard/credits", icon: "CR" },
      { label: "Purchases", href: "/dashboard/purchases", icon: "PU" },
      { label: "Licenses", href: "/dashboard/licenses", icon: "LC" },
      {
        label: "Settings",
        href: "/dashboard/settings",
        icon: "SE",
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
    items: [{ label: "Admin", href: "/dashboard/admin", icon: "AD", adminOnly: true }],
  },
];

// Sprint IA1 - `/dashboard/orders` (services/order.service.ts, static
// data/orders.ts mock) is a legacy duplicate of the real, DB-backed
// Purchases page (same class of gap Sprint L2.5 removed for Payments) - no
// nav entry given to it in the new IA. The route itself is left untouched
// (deleting/migrating it is a data/functionality change, out of scope for
// a navigation sprint) - flagged in the sprint report for a follow-up
// cleanup pass, not silently dropped.
