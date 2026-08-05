// app/company/vision/page.tsx
// Sprint D2.4.A1 - Mission and Vision are combined on one page rather than
// split into two near-identical thin pages: there is no distinct existing
// "mission statement" separate from the platform's stated vision anywhere
// in the codebase, and manufacturing an artificial distinction between them
// would itself be a small fabrication. Assembled from
// sections/EnterpriseTrust.tsx's properties and sections/WhyChoose.tsx's
// comparison framing, both already-published homepage content.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Vision",
  description: "Why Algotraders24 AI is built the way it is — verifiable, not just trusted.",
  alternates: { canonical: "/company/vision" },
};

const PROPERTIES = [
  { title: "Deterministic, not probabilistic", detail: "The same evidence produces the same analysis, every time it's run. Re-running an analysis is a way to verify it, not a way to get a different answer." },
  { title: "Every claim is sourced", detail: "Nothing is asserted without an attributed source and a timestamp attached. There is no step in the pipeline that outputs a claim with no evidence behind it." },
  { title: "Risk is disclosed, never averaged away", detail: "Risk is assessed across eight independent categories and reported as the worst of them — never blended into one reassuring number that hides which category is actually elevated." },
  { title: "The AI restates. It never reasons.", detail: "The language model's only role is to phrase an already-computed, deterministic result in plain English. It is explicitly instructed never to add a fact, price, or conclusion that isn't already there." },
] as const;

export default function VisionPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Company / Vision"
        title="Verify it. Don't just trust it."
        subtitle="No client logos, no certifications, no claimed track record — we don't have those yet, and won't pretend to. What we can show is how the system itself is built to be checked."
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

      <section className="px-6 py-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Where this is going</p>
          <p className="mt-4 text-sm leading-7 text-text-2">
            The same discipline extends to every module — Assistant, Knowledge Base, Market Intelligence, and
            Publishing all reason from one shared, deterministic evidence layer, not eight disconnected tools each
            with their own idea of the truth. That&apos;s the standard every future capability we build gets held to,
            not just the ones that exist today.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
