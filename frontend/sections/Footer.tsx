// sections/Footer.tsx
// Sprint H1.3 - Rebuilt per the approved Sprint H1.1 audit and H1.2A
// design system: every link resolves to a real page (no href="#"
// placeholders, no invented "AI Academy"/"Careers"/"Blog" destinations
// that don't exist), and no fabricated statistics, testimonials, or trust
// indicators - the risk disclosure line is real, plain text, not a link.
//
// Sprint D2.4.A1 - rebuilt to the approved categorized IA: Products,
// Platform, Solutions, Resources, Company, Support, Account. Every link
// still resolves to something real per the rule above - Solutions/Resources/
// Company link to their real hub pages even for the children that aren't
// built yet, rather than each pointing at a dead href. No Social/Developers
// column: no real social profiles are confirmed to exist (matching
// app/layout.tsx's own "no sameAs" discipline) and Developers was
// explicitly scoped as future-only by the approved IA plan - building five
// empty stub pages for it would be exactly the invented-destination problem
// this file has avoided since H1.3.
import Link from "next/link";
import BrandLogo from "@/components/brand/BrandLogo";

interface FooterLink {
  label: string;
  href: string;
}

const PRODUCTS: FooterLink[] = [
  { label: "All Products", href: "/products" },
  { label: "MT5 Expert Advisors", href: "/products?category=mt5-expert-advisors" },
  { label: "TradingView Indicators", href: "/products?category=tradingview-indicators" },
  { label: "Crypto Bots", href: "/products?category=crypto-bots" },
];

const PLATFORM: FooterLink[] = [
  { label: "AI Assistant", href: "/platform/assistant" },
  { label: "Market Intelligence", href: "/platform/market-intelligence" },
  { label: "Trading Workspace", href: "/platform/workspace" },
  { label: "Publishing", href: "/platform/publishing" },
  { label: "Knowledge Base", href: "/platform/knowledge-base" },
];

const SOLUTIONS: FooterLink[] = [
  { label: "Retail Traders", href: "/solutions/retail-traders" },
  { label: "Professional Traders", href: "/solutions/professional-traders" },
  { label: "All Solutions", href: "/solutions" },
];

const RESOURCES: FooterLink[] = [
  { label: "FAQ", href: "/resources/faq" },
  { label: "All Resources", href: "/resources" },
];

const COMPANY: FooterLink[] = [
  { label: "About", href: "/company/about" },
  { label: "Vision", href: "/company/vision" },
  { label: "Disclaimer", href: "/company/disclaimer" },
];

const SUPPORT: FooterLink[] = [
  { label: "Contact", href: "/company/contact" },
  { label: "FAQ", href: "/resources/faq" },
];

const ACCOUNT: FooterLink[] = [
  { label: "Sign In", href: "/login" },
  { label: "Create Account", href: "/signup" },
];

function Column({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h4 className="mb-4 text-sm font-semibold">{title}</h4>
      <ul className="space-y-3 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-text-2 transition-colors hover:text-gold">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-border bg-ink pt-12 pb-8 text-text md:pt-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-7">
          <div className="sm:col-span-2 lg:col-span-2">
            <BrandLogo variant="full" size="sm" withDescriptor={false} />
            <p className="mt-4 max-w-sm text-sm leading-6 text-text-2">
              An AI Trading Intelligence Platform — deterministic, evidence-based market analysis, explained in
              plain language.
            </p>
          </div>

          <Column title="Products" links={PRODUCTS} />
          <Column title="Platform" links={PLATFORM} />
          <Column title="Solutions" links={SOLUTIONS} />
          <Column title="Resources" links={RESOURCES} />
          <Column title="Company" links={COMPANY} />
        </div>

        <div className="mt-10 grid gap-10 border-t border-border pt-10 sm:grid-cols-2">
          <Column title="Support" links={SUPPORT} />
          <Column title="Account" links={ACCOUNT} />
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
