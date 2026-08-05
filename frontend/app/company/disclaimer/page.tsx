// app/company/disclaimer/page.tsx
// Sprint D2.4.A1 - assembled from the two real disclaimer strings already
// live in the codebase: sections/Footer.tsx's general risk-disclosure line
// and lib/ai/disclaimer.ts's AI_DISCLAIMER_TEXT (Sprint D2.3.S4). No new
// legal text is authored here - this is not a substitute for the Privacy
// Policy/Terms/Cookie Policy pages, which remain withheld until real legal
// text exists (see /company for that note).
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { AI_DISCLAIMER_TEXT } from "@/lib/ai/disclaimer";

export const metadata: Metadata = {
  title: "Disclaimer",
  description: "Risk and AI-output disclosures for Algotraders24 AI.",
  alternates: { canonical: "/company/disclaimer" },
};

export default function DisclaimerPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Company / Disclaimer" title="Risk & AI-output disclosure" />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="rounded-card border border-border bg-ink-2 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">Trading risk</h2>
            <p className="mt-3 text-sm leading-7 text-text-2">
              Trading involves risk. Past performance does not guarantee future results.
            </p>
          </div>
          <div className="rounded-card border border-border bg-ink-2 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">AI-generated analysis</h2>
            <p className="mt-3 text-sm leading-7 text-text-2">{AI_DISCLAIMER_TEXT}</p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
