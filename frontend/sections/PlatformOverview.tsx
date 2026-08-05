// sections/PlatformOverview.tsx
// Sprint H1.4 Phase 2, upgraded in H1.5 - "What is Algotraders24 AI?" Four
// real capabilities, each labeled honestly: the AI Assistant and Knowledge
// Base are live, database-backed features today (app/dashboard/assistant,
// app/dashboard/knowledge); Market Intelligence and Explainable Analysis
// describe the real, extensively-validated deterministic pipeline built
// across Sprint 15D, rolling out across the platform - neither is
// overclaimed as already powering every dashboard page. No marketing
// exaggeration, no invented features.
//
// Sprint D2.4.A2 - homepage compression. The H1.5 click-to-expand "How it
// works" detail sentence for each card is dropped here, not deleted: every
// one of those four sentences is already covered (verbatim or in full
// technical depth) on that capability's dedicated /platform/* page - the
// Assistant and Knowledge Base pages quote them exactly, and the Market
// Intelligence page's 5-stage + 7-service breakdown covers both the Market
// Intelligence and Explainable Analysis detail sentences in far more depth.
// This is now a static Server Component (no useState/expand interaction
// needed) with a real "Learn More" link per card instead.
import Link from "next/link";
import RevealOnScroll from "@/components/motion/RevealOnScroll";

const CAPABILITIES = [
  {
    status: "Available today",
    title: "AI Assistant",
    description:
      "A conversational interface grounded in real evidence, not a generic chatbot — ask a question in plain language, get an answer backed by real reasoning.",
    href: "/platform/assistant",
  },
  {
    status: "Available today",
    title: "Knowledge Base",
    description:
      "A searchable, retrieval-augmented knowledge layer the Assistant draws on for grounded answers — built on real documents, not improvised from memory.",
    href: "/platform/knowledge-base",
  },
  {
    status: "Engineered pipeline",
    title: "Market Intelligence",
    description:
      "Price and news evidence is collected, deduplicated, and reasoned about through a deterministic pipeline — evidence in, reasoning out, never a black-box prediction.",
    href: "/platform/market-intelligence",
  },
  {
    status: "Engineered pipeline",
    title: "Explainable Analysis",
    description:
      "Every analysis carries its supporting evidence, opposing evidence, stated limitations, a confidence score, and a risk level — nothing hidden behind a single number.",
    href: "/platform/market-intelligence",
  },
] as const;

export default function PlatformOverview() {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Platform Overview</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">What is Algotraders24 AI?</h2>
          <p className="mt-5 text-lg text-text-2">
            Four real capabilities working from the same deterministic foundation — not four disconnected tools.
          </p>
        </div>

        <RevealOnScroll>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((capability) => (
              <div
                key={capability.title}
                className="flex flex-col rounded-card border border-border bg-ink-2 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
              >
                <span className="inline-block w-fit rounded-control border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
                  {capability.status}
                </span>
                <h3 className="mt-5 text-xl font-semibold">{capability.title}</h3>
                <p className="mt-3 text-sm leading-6 text-text-2">{capability.description}</p>
                <Link
                  href={capability.href}
                  className="mt-5 text-sm font-semibold text-gold transition-colors hover:text-gold-strong"
                >
                  Learn More →
                </Link>
              </div>
            ))}
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
