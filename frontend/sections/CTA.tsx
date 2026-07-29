// sections/CTA.tsx
// Sprint H1.5 - full rewrite. The previous version was a decorative
// blue-to-purple gradient box with non-functional <button> elements (no
// href), generic "Join thousands of traders" copy, and an unverified "No
// credit card required" claim - all removed. Per the approved H1.2B motion
// rules for the final CTA: one headline, one restrained panel, real links,
// nothing invented. Server Component: static content, no interactivity
// needed.
import Link from "next/link";

export default function CTA() {
  return (
    <section className="bg-ink-2 py-24 text-text">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="font-display text-4xl font-medium md:text-5xl">Trade with evidence, not guesswork.</h2>
        <p className="mt-5 text-lg text-text-2">
          Ask a question and see the reasoning behind the answer — or explore the tools built on the same engine.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/dashboard/assistant"
            className="rounded-control bg-gold px-8 py-4 font-semibold text-ink transition hover:brightness-110"
          >
            Ask the AI Assistant
          </Link>
          <Link
            href="/products"
            className="rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold"
          >
            Explore Products
          </Link>
        </div>
      </div>
    </section>
  );
}
