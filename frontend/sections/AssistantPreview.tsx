"use client";

// sections/AssistantPreview.tsx
// Sprint H1.4 Phase 5 - illustrative only. Shows the shape and style of a
// real conversation with the AI Assistant, never a live market call: the
// panel is explicitly labeled "Illustrative example - not a live market
// analysis", and the answer describes HOW the Assistant reasons rather
// than asserting a specific price, confidence number, or verdict as fact.
//
// A small client component only because the staggered reveal genuinely
// needs to be gated on scroll: this section is below the fold, so an
// animation that simply played on mount would already be finished by the
// time a visitor scrolls to it, and the "watch it build" effect - the
// entire point of this section - would never be seen. Everything else in
// this file is static markup.
import { useEffect, useRef, useState } from "react";

const ANSWER_LINES = [
  "Here's what the available evidence shows, and what it doesn't.",
  "Supporting evidence points one way; at least one source disagrees — I'll never average that away.",
  "Confidence reflects how much evidence exists and how well it agrees, not a guess dressed up as certainty.",
  "Risk is broken down by category, not collapsed into one number.",
];

export default function AssistantPreview() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }

    const node = panelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="bg-ink py-24 text-text">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">AI Assistant</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Ask a question, see the reasoning</h2>
          <p className="mt-5 text-lg text-text-2">A preview of how the Assistant responds — grounded, not guessed.</p>
        </div>

        <div ref={panelRef} className="mt-14 rounded-panel border border-border bg-ink-2 p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-text-2">Sample conversation</span>
            <span className="rounded-control border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
              Illustrative example — not a live market analysis
            </span>
          </div>

          <div className="space-y-6">
            <div className="ml-auto max-w-md rounded-card bg-ink-3 px-5 py-3 text-sm text-text">
              What&apos;s your view on gold right now?
            </div>

            <div className="max-w-lg space-y-3 rounded-card border border-border bg-ink px-5 py-4">
              {ANSWER_LINES.map((line, index) => (
                <p
                  key={line}
                  className={`text-sm leading-6 text-text-2 transition-all duration-500 ${
                    revealed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                  }`}
                  style={{ transitionDelay: revealed ? `${index * 140}ms` : "0ms" }}
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
