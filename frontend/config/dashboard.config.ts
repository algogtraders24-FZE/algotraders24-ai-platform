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
export interface DashboardNavItem {
  label: string;
  href: string;
  icon: string;
  // Sprint L2.6 - only rendered for role === "admin" (see
  // DashboardSidebar.tsx); the real gate is still server-side
  // (requireRole in app/dashboard/admin/layout.tsx) - hiding the link is
  // just discoverability, never the actual authorization boundary.
  adminOnly?: boolean;
}
export const DASHBOARD_NAV: DashboardNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "DB" },
  // Sprint D2.3 - the Intelligence Workspace (new premium experience). Placed
  // right after Dashboard so it is the first destination after the overview.
  { label: "Workspace", href: "/dashboard/workspace", icon: "WS" },
  { label: "Licenses", href: "/dashboard/licenses", icon: "LC" },
  // Sprint M13 (closing the marketplace delivery loop) - the real,
  // DB-backed buyer purchase/license/download history. Distinct from
  // "Licenses" above (pre-existing, reads mock data for an unrelated
  // feature) - added as its own nav entry rather than replacing it, since
  // that page's own real intent/audience was never determined this sprint.
  { label: "My Purchases", href: "/dashboard/purchases", icon: "MPU" },
  // Sprint M12 branding follow-on - the seller backoffice
  // (app/marketplace/my-products) existed and was fully functional but had
  // no navigation entry anywhere, making it undiscoverable except by typing
  // the URL directly - same class of gap L2.3's own comment above warns
  // about, just missing rather than dead.
  { label: "My Products", href: "/marketplace/my-products", icon: "MP" },
  { label: "AI Signals", href: "/dashboard/signals", icon: "SG" },
  { label: "Market Intel", href: "/dashboard/market-intelligence", icon: "MI" },
  { label: "AI News", href: "/dashboard/news", icon: "NW" },
  { label: "AI Assistant", href: "/dashboard/assistant", icon: "AI" },
  { label: "Trading Copilot", href: "/dashboard/trading-copilot", icon: "CP" },
  { label: "Publishing", href: "/dashboard/publishing", icon: "PB" },
  { label: "Automation", href: "/dashboard/automation", icon: "AU" },
  { label: "AI Agents", href: "/dashboard/agents", icon: "AG" },
  { label: "Knowledge Base", href: "/dashboard/knowledge", icon: "KB" },
  { label: "Orders", href: "/dashboard/orders", icon: "OR" },
  { label: "Billing", href: "/dashboard/billing", icon: "BL" },
  { label: "Admin", href: "/dashboard/admin", icon: "AD", adminOnly: true },
];
