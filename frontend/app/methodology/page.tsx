// app/methodology/page.tsx
// How the automated blog reports are produced. Every statement here describes
// what the code does (services/publishing/daily-auto-publisher.service.ts and
// the Market Intelligence pipeline) - no claim of human authorship or review.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Algotraders24 AI produces its market reports: live data, a deterministic evidence pipeline, plain-language restatement by AI, and clear limits.",
  alternates: { canonical: "/methodology" },
};

const STEPS = [
  {
    title: "1. Live market data",
    body: "Prices come from MetaTrader 5 (live feed), with Twelve Data and Alpha Vantage as fallbacks. If data for an instrument is unavailable, the report for that instrument is not published - we do not fill gaps.",
  },
  {
    title: "2. Evidence, not opinion",
    body: "A deterministic pipeline collects price, technical structure (support and resistance, trend, liquidity zones), news headlines, the economic calendar and macro drivers. Each item is ranked, and supporting and opposing evidence are both kept.",
  },
  {
    title: "3. Risk and confidence",
    body: "Risk is assessed across several categories and reported as the worst of them, not averaged into a reassuring number. Confidence is a score computed from the evidence, and its limits are stated.",
  },
  {
    title: "4. AI restates, never decides",
    body: "An AI model puts the computed result into plain language. It is instructed to restate the evidence, not to add facts or issue a buy or sell instruction. The text is then checked for empty or placeholder output before it can be published.",
  },
  {
    title: "5. Automated schedule",
    body: "Reports are generated and published automatically: daily instrument reports (gold, a forex pair, a crypto pair), fundamental analysis twice a week, an economic calendar preview on Mondays and a weekly review on Sundays. Weekend reports cover crypto only because gold and forex markets are closed.",
  },
] as const;

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Algotraders24"
        title="How our reports are made"
        subtitle="Automated, evidence-based, and honest about its limits."
      />
      <section className="px-6 pb-16 pt-4">
        <div className="mx-auto max-w-3xl space-y-6">
          {STEPS.map((step) => (
            <div key={step.title} className="rounded-panel border border-border bg-ink-2 p-6">
              <h2 className="text-lg font-semibold text-text">{step.title}</h2>
              <p className="mt-2 leading-7 text-text-2">{step.body}</p>
            </div>
          ))}

          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">Limits you should know</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 leading-7 text-text-2">
              <li>These reports are written by an automated system, not by a named human analyst.</li>
              <li>They describe evidence at the time of writing; markets can change within minutes.</li>
              <li>Economic calendar times are in UTC and can change. Forecast values are consensus figures from the feed.</li>
              <li>Nothing here is financial advice or a recommendation to buy, sell or hold any instrument.</li>
            </ul>
          </div>

          <p className="text-sm text-text-3">
            Read the full <Link href="/company/disclaimer" className="text-gold hover:underline">disclaimer</Link>, or
            see <Link href="/company/about" className="text-gold hover:underline">what we build on</Link>. Browse all
            reports on the <Link href="/blog" className="text-gold hover:underline">blog</Link>.
          </p>
        </div>
      </section>
      <Footer />
    </main>
  );
}
