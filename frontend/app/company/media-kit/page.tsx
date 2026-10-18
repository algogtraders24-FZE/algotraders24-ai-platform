// app/company/media-kit/page.tsx
// Media Kit: the facts a journalist, partner or listing site needs, in one place. Only things already public on this
// site (company line, address, product list, contact channels). No user numbers, revenue, funding or customer logos -
// we do not claim any we cannot show.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Media Kit",
  description: "Facts, a short description, product list and contact details for writing about Algotraders24 AI.",
  alternates: { canonical: "/company/media-kit" },
};

const SHORT = "Algotraders24 AI is an AI trading intelligence platform. It explains markets in plain language from verifiable evidence, lets traders backtest their own ideas, and runs a marketplace for trading software where every listing states how much evidence stands behind it.";

const LONG =
  "Algotraders24 AI combines three things. Market Intelligence turns live market evidence - technical, macro, calendar, news and structure - into an explained analysis with supporting and opposing evidence, an eight-category risk breakdown and a confidence score. It does not sell buy-or-sell signals. Quant Lite and Quant Pro let traders describe a strategy, backtest it on real history and download MT4, MT5 or Pine Script code. The Marketplace sells Expert Advisors and other trading tools, with labels that say whether a product was validated by AT24, checked from the seller's report or not checked. The company publishes its own validation research, including results that did not go its way, and a live scoreboard that checks every volatility range it states.";

const FACTS: { label: string; value: string }[] = [
  { label: "Name", value: "Algotraders24 AI (AT24)" },
  { label: "What we are", value: "FinTech technology and software development company" },
  { label: "Registered address", value: "Saint Vincent and the Grenadines, Queens Drive, Park Industrial Site, Kingstown, VC0100" },
  { label: "Website", value: "algotraders24.ai" },
  { label: "Products", value: "AI Assistant, Market Intelligence, Trading Workspace, Quant Lite (free), Quant Pro, Marketplace, Live Sync, Live Results, Edge Analyzer" },
  { label: "Markets covered", value: "Gold, Silver, EUR/USD, GBP/USD, USD/JPY, Bitcoin, Ethereum" },
  { label: "Platforms", value: "MetaTrader 5 and 4, TradingView, cTrader, NinjaTrader" },
];

const GOOD_TO_KNOW = [
  "We are not a signal service and do not tell anyone when to buy or sell.",
  "We publish our test results, including the ones that failed: see Research.",
  "Backtests and live results are informational. Past results do not guarantee future results.",
] as const;

export default function MediaKitPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Company / Media kit"
        title="Media kit"
        subtitle="What you need to write about Algotraders24 AI, accurately."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-12">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">About us</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Card padding="lg">
                <h3 className="text-sm font-semibold">Short description</h3>
                <p className="mt-3 text-sm leading-6 text-text-2">{SHORT}</p>
              </Card>
              <Card padding="lg">
                <h3 className="text-sm font-semibold">Longer description</h3>
                <p className="mt-3 text-sm leading-6 text-text-2">{LONG}</p>
              </Card>
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Facts</h2>
            <dl className="mt-4 divide-y divide-border rounded-card border border-border bg-ink-2">
              {FACTS.map((f) => (
                <div key={f.label} className="grid gap-1 p-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                  <dt className="text-sm font-semibold">{f.label}</dt>
                  <dd className="text-sm text-text-2">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Good to know</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
              {GOOD_TO_KNOW.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card padding="lg">
              <h3 className="text-sm font-semibold">Logos, colours and rules</h3>
              <p className="mt-3 text-sm text-text-2">Official files and how to use them.</p>
              <Link href="/company/brand-assets" className="mt-3 inline-block text-sm font-semibold text-gold underline-offset-4 hover:underline">
                Brand assets
              </Link>
            </Card>
            <Card padding="lg">
              <h3 className="text-sm font-semibold">Press and partnership enquiries</h3>
              <p className="mt-3 text-sm text-text-2">
                Write to{" "}
                <a href="mailto:support@algotraders24.ai" className="text-gold underline-offset-4 hover:underline">
                  support@algotraders24.ai
                </a>{" "}
                or use the Contact page.
              </p>
              <Link href="/company/contact" className="mt-3 inline-block text-sm font-semibold text-gold underline-offset-4 hover:underline">
                Contact
              </Link>
            </Card>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
