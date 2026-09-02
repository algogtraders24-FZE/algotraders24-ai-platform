// sections/Footer.tsx
// Sprint H1.3 - Rebuilt per the approved Sprint H1.1 audit and H1.2A
// design system: every link resolves to a real page (no href="#"
// placeholders, no invented "AI Academy"/"Careers"/"Blog" destinations
// that don't exist), and no fabricated statistics, testimonials, or trust
// indicators - the risk disclosure line is real, plain text, not a link.
//
// Sprint D2.4.A1 - rebuilt to the approved categorized IA: Products,
// Platform, Solutions, Resources, Company, Support, Account.
//
// Sprint D2.4.A4 - expanded to the full Binance-style 8-category taxonomy
// the user specified (Company, Resources, Platform, Products, Solutions,
// Developers, Legal, Account). The H1.3 rule above still holds: every
// FooterItem with an `href` is a real, resolvable destination; every item
// without one renders as a disabled, non-clickable label with a "Soon"
// badge instead - never an invented page, never href="#". Concretely:
//   - "Mission" is not a separate entry: /company/vision already combines
//     Mission and Vision (see that page's own header comment for why a
//     distinct Mission page would be an artificial split) - a second link
//     with a different label pointing at the same page would misrepresent
//     it as distinct content.
//   - Legal is mostly disabled: Privacy/Terms/Cookie/Refund/AML-KYC require
//     real legal text and lawyer review per the user's own content policy
//     (Claude must never draft these). Disclaimer and Risk Disclosure both
//     link to /company/disclaimer, which already covers both the risk
//     disclosure and the AI-output disclaimer - not two different pages.
//   - Developers is entirely disabled: explicitly scoped "Future" with no
//     real API/SDK/docs/GitHub today.
//   - No Social column: no real social profiles are confirmed to exist
//     (matching app/layout.tsx's own "no sameAs" discipline), same
//     decision D2.4.A1 made when this was last asked.
//   - Platform's Automation/AI Agents/Trading Copilot link straight to
//     their real /dashboard/* route (no dedicated marketing page yet),
//     same pattern the /platform hub uses for the same three modules.
//
// Sprint Q1.6 - "Quant Lite (Free)" added as the first Products item
// (/quant-lite, real and fully built since Q0.7-Q1.5) - it had no footer
// presence at all before this, matching Navbar.tsx's same gap/fix.
import Link from "next/link";
import BrandLogo from "@/components/brand/BrandLogo";

interface FooterItem {
  label: string;
  href?: string; // omitted => not built yet, renders as a disabled "Soon" label
}

const COMPANY: FooterItem[] = [
  { label: "About", href: "/company/about" },
  { label: "Vision", href: "/company/vision" },
  { label: "Contact", href: "/company/contact" },
  { label: "Careers" },
  { label: "Partners" },
  { label: "Media Kit" },
  { label: "Brand Assets" },
];

const RESOURCES: FooterItem[] = [
  { label: "FAQ", href: "/resources/faq" },
  { label: "All Resources", href: "/resources" },
  { label: "Blog" },
  { label: "Tutorials" },
  { label: "Release Notes" },
  { label: "Roadmap" },
  { label: "Documentation" },
  { label: "Research" },
  { label: "Market Insights" },
];

const PLATFORM: FooterItem[] = [
  { label: "AI Assistant", href: "/platform/assistant" },
  { label: "Market Intelligence", href: "/platform/market-intelligence" },
  { label: "Trading Workspace", href: "/platform/workspace" },
  { label: "Publishing", href: "/platform/publishing" },
  { label: "Knowledge Base", href: "/platform/knowledge-base" },
  { label: "Research", href: "/platform/research" },
  { label: "Automation", href: "/dashboard/automation" },
  { label: "AI Agents", href: "/dashboard/agents" },
  { label: "Trading Copilot", href: "/dashboard/trading-copilot" },
];

const PRODUCTS: FooterItem[] = [
  { label: "Quant Lite (Free)", href: "/quant-lite" },
  { label: "MT5 Expert Advisors", href: "/products?category=mt5-expert-advisors" },
  { label: "TradingView Indicators", href: "/products?category=tradingview-indicators" },
  { label: "Crypto Bots", href: "/products?category=crypto-bots" },
  { label: "cTrader cBots", href: "/products?category=ctrader-cbots" },
  { label: "NinjaTrader Bots", href: "/products?category=ninjatrader-bots" },
  { label: "Indian Market Algos", href: "/products?category=indian-market-algos" },
  { label: "All Products", href: "/products" },
];

const SOLUTIONS: FooterItem[] = [
  { label: "Retail Traders", href: "/solutions/retail-traders" },
  { label: "Professional Traders", href: "/solutions/professional-traders" },
  { label: "All Solutions", href: "/solutions" },
  { label: "Prop Firms" },
  { label: "Hedge Funds" },
  { label: "Institutions" },
];

const DEVELOPERS: FooterItem[] = [{ label: "API" }, { label: "SDK" }, { label: "Documentation" }, { label: "GitHub" }];

const LEGAL: FooterItem[] = [
  { label: "Disclaimer", href: "/company/disclaimer" },
  { label: "Risk Disclosure", href: "/company/disclaimer" },
  { label: "Privacy Policy" },
  { label: "Terms of Service" },
  { label: "Cookie Policy" },
  { label: "Refund Policy" },
  { label: "AML / KYC" },
];

const ACCOUNT: FooterItem[] = [
  { label: "Sign In", href: "/login" },
  { label: "Create Account", href: "/signup" },
];

function Column({ title, items }: { title: string; items: FooterItem[] }) {
  return (
    <div>
      <h4 className="mb-4 text-sm font-semibold">{title}</h4>
      <ul className="space-y-3 text-sm">
        {items.map((item) =>
          item.href ? (
            <li key={item.label}>
              <Link href={item.href} className="text-text-2 transition-colors hover:text-gold">
                {item.label}
              </Link>
            </li>
          ) : (
            <li key={item.label} className="flex items-center gap-2 text-text-3">
              <span>{item.label}</span>
              <span className="rounded-control border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Soon
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-border bg-ink pt-12 pb-8 text-text md:pt-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="max-w-sm">
          <BrandLogo variant="full" size="sm" withDescriptor={false} />
          <p className="mt-4 text-sm leading-6 text-text-2">
            An AI Trading Intelligence Platform — deterministic, evidence-based market analysis, explained in plain
            language.
          </p>
        </div>

        <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <Column title="Products" items={PRODUCTS} />
          <Column title="Platform" items={PLATFORM} />
          <Column title="Solutions" items={SOLUTIONS} />
          <Column title="Resources" items={RESOURCES} />
        </div>

        <div className="mt-10 grid gap-10 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-4">
          <Column title="Company" items={COMPANY} />
          <Column title="Developers" items={DEVELOPERS} />
          <Column title="Legal" items={LEGAL} />
          <Column title="Account" items={ACCOUNT} />
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
          <p className="text-sm text-text-3">© 2026 Algotraders24 AI. All rights reserved.</p>
          <p className="max-w-2xl text-center text-xs text-text-3 md:text-right">
            Trading involves risk. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </footer>
  );
}
