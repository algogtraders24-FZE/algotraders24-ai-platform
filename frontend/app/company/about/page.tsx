// app/company/about/page.tsx
// Sprint D2.4.A1 - assembled entirely from real, already-published facts:
// the platform's own positioning (FAQ.tsx's first two answers, root
// layout.tsx's description, TrustStrip.tsx's five pillars) and the real
// company/registration fact from the company's existing algotraders24.com
// site (UAE-based, Ajman Free Zone) - no new claims invented for this page.
import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Link2 as LinkIcon, ShieldAlert, Repeat2, Boxes } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "About",
  description: "Algotraders24 AI is an AI Trading Intelligence Platform — evidence-based, explainable, built for decision support, not signals.",
  alternates: { canonical: "/company/about" },
};

const PILLARS = [
  { icon: Eye, title: "Explainable AI", description: "The model only restates a computed result in plain language — it never adds a fact or conclusion of its own." },
  { icon: LinkIcon, title: "Evidence-Based", description: "Every claim carries an attributed source and timestamp — no step outputs an assertion with nothing behind it." },
  { icon: ShieldAlert, title: "Risk-Aware", description: "Risk is assessed across eight categories and reported as the worst — never blended into one reassuring number." },
  { icon: Repeat2, title: "Deterministic", description: "The same evidence produces the same analysis, every time — re-running verifies it, never reshuffles it." },
  { icon: Boxes, title: "Enterprise Architecture", description: "One orchestrated pipeline of named services, in the same order every run — built to be audited, not trusted on faith." },
] as const;

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Company / About" title="An AI Trading Intelligence Platform" />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <p className="text-lg leading-8 text-text-2">
            Algotraders24 AI runs market evidence through a deterministic pipeline — evidence, reasoning, risk, and
            confidence — and explains every conclusion in plain language. It&apos;s built for decision support, not
            for handing you a verdict to follow blindly.
          </p>
          <p className="text-sm leading-7 text-text-3">
            We don&apos;t sell buy-or-sell signals. Instead of a bare instruction, every analysis shows the supporting
            and opposing evidence, an eight-category risk breakdown, and a confidence score — so you can weigh the
            reasoning and check the work yourself.
          </p>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-sm font-semibold uppercase tracking-[0.2em] text-gold">What we build on</p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {PILLARS.map((pillar) => (
              <div key={pillar.title} className="flex flex-col gap-3 rounded-card border border-border bg-ink-2 p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                  <pillar.icon className="h-4 w-4 text-gold" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-text">{pillar.title}</h2>
                  <p className="mt-1.5 text-sm leading-6 text-text-2">{pillar.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-3xl rounded-card border border-border bg-ink-2 p-6 text-center">
          <p className="text-sm leading-6 text-text-2">
            Algotraders24 AI is built by a UAE-based FinTech team, registered in Ajman Free Zone, UAE.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 pb-16 text-center">
        <Link href="/company/vision" className="text-sm font-semibold text-gold hover:text-gold-strong">
          Read our vision →
        </Link>
      </div>

      <Footer />
    </main>
  );
}
