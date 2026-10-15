// app/markets/page.tsx
// Index of the public market hubs. Static: lists the seven instruments with a one-line description and a link.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { MARKETS } from "@/services/markets/hub";
import { breadcrumbJsonLd, jsonLdString } from "@/lib/seo/seo";

export const metadata: Metadata = {
  title: "Live markets: expected range, key levels and macro drivers",
  description: "Gold, silver, EUR/USD, GBP/USD, USD/JPY, Bitcoin and Ethereum: how far each typically moves over the next 12 and 24 hours (self-checked), key levels, macro drivers and upcoming releases. No buy or sell calls.",
  alternates: { canonical: "/markets" },
  openGraph: { title: "Live markets - Algotraders24 AI", description: "Measured, self-checked market context for seven instruments. Never a buy or sell call.", type: "website", url: "/markets", images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Algotraders24 AI live markets" }] },
};

export default function MarketsIndexPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Markets", path: "/markets" }])) }} />
      <Navbar />
      <PageHero eyebrow="Markets" title="Live market context" subtitle="Expected range, key levels, macro drivers and upcoming releases - measured and self-checked." />
      <section className="px-6 pb-16 pt-4">
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
          {MARKETS.map((m) => (
            <Link key={m.slug} href={`/markets/${m.slug}`} className="rounded-panel border border-border bg-ink-2 p-6 transition-colors hover:border-gold/40">
              <p className="text-lg font-semibold text-text">
                {m.longName} <span className="ml-1 font-mono text-xs text-text-3">{m.symbol}</span>
              </p>
              <p className="mt-2 text-sm leading-6 text-text-2">{m.about.split(". ")[0]}.</p>
              <p className="mt-3 text-sm text-gold">Open the live page</p>
            </Link>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-5xl text-sm text-text-3">
          The ranges are checked against what happens next on the <Link href="/calibration" className="text-gold hover:underline">calibration scoreboard</Link>. Nothing here is financial advice.
        </p>
      </section>
      <Footer />
    </main>
  );
}
