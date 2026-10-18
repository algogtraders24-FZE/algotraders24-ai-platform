// app/resources/documentation/page.tsx
// Documentation hub: a reference map of the platform - what each part is, how it behaves and where its rules live.
// Statements are the same facts as the public support knowledge base (scripts/seed-support-kb.ts); nothing here describes
// a feature that is not live. Step-by-step how-tos are on /resources/tutorials; policies are under /company.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "A reference to Algotraders24 AI: how the analysis pipeline works, what each tool does and does not do, plans and credits, the marketplace, licences, data and policies.",
  alternates: { canonical: "/resources/documentation" },
};

interface Doc {
  title: string;
  body: string;
  links?: { label: string; href: string }[];
}

interface Section {
  heading: string;
  docs: Doc[];
}

const SECTIONS: readonly Section[] = [
  {
    heading: "How the platform works",
    docs: [
      {
        title: "The analysis pipeline",
        body: "Every analysis runs the same services in the same order: market data is ingested, evidence is fused and ranked, reasoning classifies each item as supporting, opposing or unresolved, risk is assessed across eight categories, confidence is scored, and the result is composed into plain language. It is deterministic: the same evidence always produces the same analysis.",
        links: [
          { label: "Methodology", href: "/methodology" },
          { label: "Research", href: "/resources/research" },
        ],
      },
      {
        title: "Not a signal service",
        body: "We do not sell buy-or-sell signals. You see the supporting and opposing evidence, an eight-category risk breakdown and a confidence score, so you can weigh the reasoning yourself. When data for a market is missing, the tools say \"not available\" rather than invent a number.",
      },
      {
        title: "Markets and data",
        body: "Live pages cover Gold, Silver, EUR/USD, GBP/USD, USD/JPY, Bitcoin and Ethereum. Market data comes from MetaTrader 5 first, with a fallback provider. Coverage depends on the connected provider and continues to expand.",
        links: [
          { label: "Markets", href: "/markets" },
          { label: "Calibration Scoreboard", href: "/calibration" },
        ],
      },
    ],
  },
  {
    heading: "Tools",
    docs: [
      {
        title: "AI Assistant and Knowledge",
        body: "Ask market questions in plain language. Under Knowledge you can save My Trading Rules and upload your own documents (text, Markdown or Word); the Assistant then answers with them in mind and only restates what you wrote.",
        links: [{ label: "Platform: AI Assistant", href: "/platform/assistant" }],
      },
      {
        title: "Market Intelligence, Signals and Trading Copilot",
        body: "Market Intelligence analyses a market from technical evidence, macro and cross-asset drivers, the economic calendar, news and market structure. AI Signals summarises regime, macro alignment and data quality. The Trading Copilot gives an indicator-based analysis in a brief format. None is a BUY or SELL call, and smart-money structure is shown as context, not a predictor.",
        links: [{ label: "Platform: Market Intelligence", href: "/platform/market-intelligence" }],
      },
      {
        title: "Quant Lite and Quant Pro",
        body: "Quant Lite is free: build a strategy, backtest it on real history and download MT4, MT5 or Pine Script code. Quant Pro, included with every paid plan, adds describing an idea in plain language, run history, a strategy library, parameter optimisation and walk-forward testing. A backtest is not a prediction.",
        links: [
          { label: "Quant Lite", href: "/quant-lite" },
          { label: "Pricing", href: "/pricing" },
        ],
      },
      {
        title: "Live Sync, Live Results and Edge Analyzer",
        body: "Live Sync connects a MetaTrader 5 or 4 account through a read-only Expert Advisor (it cannot trade). Live Results shows opted-in accounts publicly; the owner controls what is shown. The Edge Analyzer reads an English MT5 HTML trade report and returns a deterministic analysis. Numbers come from your own terminal and are not verified by a broker.",
        links: [{ label: "Tutorials", href: "/resources/tutorials" }],
      },
      {
        title: "Alerts and notifications",
        body: "Alerts reach the in-app bell, your own Telegram chat and, once you install AT24 as an app and allow notifications, push. Each alert fires once and then waits before it can fire again.",
      },
    ],
  },
  {
    heading: "Plans, credits and billing",
    docs: [
      {
        title: "Plans",
        body: "The Free plan is $0 and includes core tools and a monthly AI credit allowance. You can move between Free, Pro, Elite and Enterprise from Settings, Billing. An upgrade takes effect at once with a prorated charge; a downgrade takes effect at the end of the billing period.",
        links: [{ label: "Pricing", href: "/pricing" }],
      },
      {
        title: "AI credits",
        body: "One credit is one AI chat message. Your allowance matches your plan and changes on the date a plan change takes effect.",
        links: [{ label: "FAQ", href: "/resources/faq" }],
      },
      {
        title: "Refunds",
        body: "For a refund, follow the refund policy and contact human support within 14 days of purchase.",
        links: [{ label: "Refund policy", href: "/company/refund-policy" }],
      },
    ],
  },
  {
    heading: "Marketplace and licences",
    docs: [
      {
        title: "Buying",
        body: "Products target MetaTrader 5 and 4 as Expert Advisors, plus some TradingView, cTrader and NinjaTrader builds. A product built for one platform does not run on another; check the listing's supported platforms before you buy.",
        links: [{ label: "Marketplace", href: "/marketplace" }],
      },
      {
        title: "Licences",
        body: "A purchase gives you one licence key (AT24-<licence id>.<key>) for the product you bought. It is bound by default to the trading account and server it first runs on, one account at a time. A licence can be ISSUED, ACTIVE, SUSPENDED, EXPIRED or REVOKED, and you can see its status on the Licenses page.",
      },
      {
        title: "Trust labels",
        body: "A listing is either Validated by AT24, Checked from the seller's report (an automatic reading of an attached backtest report, deliberately weaker), or Not checked. A seller can never give their own product the Validated state. Utility tools that are tested on a demo account show a Demo-Tested label instead.",
      },
      {
        title: "Selling",
        body: "Where self-serve selling is enabled for your account, you list a product from the Sell page without an admin approval step. AT24 keeps a 10% commission and an estimated gateway fee, earnings are held for 7 days, and payouts are made in USDT on request (minimum 50 USD).",
        links: [{ label: "Seller guide", href: "/resources/marketplace-seller-guide" }],
      },
    ],
  },
  {
    heading: "Data, security and policies",
    docs: [
      {
        title: "Your data and payments",
        body: "You sign in with an authenticated account. Payments are handled by established providers (cards and crypto), so sensitive payment details are handled by them, not stored by us. Your rules and documents belong to your account and you can delete them at any time.",
        links: [
          { label: "Privacy policy", href: "/company/privacy-policy" },
          { label: "Cookie policy", href: "/company/cookie-policy" },
        ],
      },
      {
        title: "Risk and legal",
        body: "Everything on the platform is informational and is not investment advice. Past results, backtests and Live Results do not guarantee future results.",
        links: [
          { label: "Disclaimer and risk disclosure", href: "/company/disclaimer" },
          { label: "Terms of service", href: "/company/terms-of-service" },
          { label: "AML / KYC", href: "/company/aml-kyc" },
        ],
      },
      {
        title: "Getting help",
        body: "Ask the AT24 Copilot, email support@algotraders24.ai, or use the Contact page (which links to WhatsApp and Telegram). If the Copilot does not have a confident answer it hands off to a person.",
        links: [{ label: "Contact", href: "/company/contact" }],
      },
    ],
  },
];

export default function DocumentationPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Resources / Documentation"
        title="Documentation"
        subtitle="What each part of AT24 is, how it behaves and where the rules are. For step-by-step help, see the tutorials."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-12">
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{section.heading}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {section.docs.map((doc) => (
                  <Card key={doc.title} padding="lg">
                    <h3 className="text-lg font-semibold">{doc.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-text-2">{doc.body}</p>
                    {doc.links && (
                      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {doc.links.map((l) => (
                          <Link key={l.href} href={l.href} className="font-semibold text-gold underline-offset-4 hover:underline">
                            {l.label}
                          </Link>
                        ))}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
          <p className="text-center text-sm text-text-2">
            Looking for how-tos?{" "}
            <Link href="/resources/tutorials" className="text-gold underline-offset-4 hover:underline">
              Tutorials
            </Link>
            . Looking for the latest changes?{" "}
            <Link href="/resources/release-notes" className="text-gold underline-offset-4 hover:underline">
              Release notes
            </Link>
            .
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
