// app/solutions/professional-traders/page.tsx
// Sprint D2.4.A1 - real platform facts (EnterpriseTrust.tsx,
// ExplainableIntelligence.tsx) re-angled for a professional-trader
// audience. No new capability claims, no fabricated stats or testimonials.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "For Professional Traders",
  description: "Auditable, category-level reasoning built to be checked, not just trusted.",
  alternates: { canonical: "/solutions/professional-traders" },
};

const PROPERTIES = [
  { title: "Deterministic, not probabilistic", detail: "The same evidence produces the same analysis, every time it's run. Re-running an analysis is a way to verify it, not a way to get a different answer." },
  { title: "Risk, disclosed by category", detail: "Assessed across eight independent categories — market, event, liquidity, volatility, execution, evidence conflict, data quality, and uncertainty — reported as the worst, never blended into one number." },
  { title: "Confidence you can interrogate", detail: "Scored from how much real evidence exists and how well it agrees, broken down by category — not a single confident-sounding figure with nothing behind it." },
  { title: "The AI restates. It never reasons.", detail: "The model's only role is to phrase an already-computed, deterministic result in plain English — it never adds a fact, price, or conclusion of its own." },
];

export default function ProfessionalTradersPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Solutions / Professional Traders"
        title="Verify it. Don't just trust it."
        subtitle="Decision support built for someone who checks the work, not someone who takes a signal on faith."
      />

      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
          {PROPERTIES.map((property) => (
            <div key={property.title} className="rounded-card border border-border bg-ink-2 p-8">
              <h2 className="text-lg font-semibold">{property.title}</h2>
              <p className="mt-3 text-sm leading-6 text-text-2">{property.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 py-8 text-center">
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/platform/market-intelligence" className="rounded-control bg-gold px-8 py-4 font-semibold text-ink transition hover:brightness-110">
            See the Full Pipeline
          </Link>
          <Link href="/pricing" className="rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold">
            View Pricing
          </Link>
        </div>
      </div>

      <Footer />
    </main>
  );
}
