// app/solutions/retail-traders/page.tsx
// Sprint D2.4.A1 - real platform facts (WhyChoose.tsx, FAQ.tsx, Pricing
// data) re-angled for a retail-trader audience. No new capability claims,
// no fabricated stats or testimonials - only real, already-published
// properties of the platform, reframed for who reads this page.
import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "For Retail Traders",
  description: "Explainable decision support instead of a black-box signal — start free.",
  alternates: { canonical: "/solutions/retail-traders" },
};

const POINTS = [
  { label: "No more disconnected tools", detail: "A chart, a news feed, and a chatbot that don't talk to each other — replaced by one shared evidence layer across every module." },
  { label: "See the reasoning, not just a number", detail: "Every claim carries an attributed source and a timestamp. Risk is broken down by category, never collapsed into one score." },
  { label: "Never a bare instruction", detail: "You get supporting and opposing evidence, an eight-category risk breakdown, and a confidence score — you weigh it and decide." },
  { label: "Free to start", detail: "The Free plan includes core tools — real AI credits, an agent, and automations — so you can try the platform before upgrading." },
];

export default function RetailTradersPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Solutions / Retail Traders"
        title="Trade with evidence, not guesswork"
        subtitle="You've read the charts, checked the news, and still second-guessed yourself. This is what changes."
      />

      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-3xl gap-5">
          {POINTS.map((point) => (
            <div key={point.label} className="flex gap-3 rounded-card border border-border bg-ink-2 p-5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
                <Check className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-text">{point.label}</p>
                <p className="mt-1 text-sm leading-6 text-text-2">{point.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 py-8 text-center">
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/signup" className="rounded-control bg-gold px-8 py-4 font-semibold text-ink transition hover:brightness-110">
            Start Free
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
