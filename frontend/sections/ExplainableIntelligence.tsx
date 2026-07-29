"use client";

// sections/ExplainableIntelligence.tsx
// Sprint H1.4 Phase 4 - the platform's signature section. Five stages,
// matching the real, deterministic architecture exactly (types/evidence.ts,
// reasoning.ts, risk-intelligence.ts, confidence-intelligence.ts,
// explainable-analysis.ts) - no invented AI graphics. This is the one
// section on the page where scroll-linked sequential motion is earned,
// per the approved Sprint H1.2B motion rules: the underlying process
// really is sequential, so this is the platform's single largest
// animation investment. Plays once, never replays on scroll back up, and
// respects prefers-reduced-motion by showing every stage immediately.
import { useEffect, useRef, useState } from "react";

const STAGES = [
  {
    title: "Evidence",
    description: "Price and news evidence collected from real, attributed sources — fused and deduplicated before anything else happens.",
  },
  {
    title: "Reasoning",
    description: "Every item is classified as supporting, opposing, or unresolved — disagreement is surfaced, never smoothed over.",
  },
  {
    title: "Risk",
    description:
      "Assessed across eight distinct categories — market, event, liquidity, volatility, execution, evidence conflict, data quality, and uncertainty.",
  },
  {
    title: "Confidence",
    description: "Scored from how much real evidence exists and how well it agrees — never a number invented to sound authoritative.",
  },
  {
    title: "Explainable Analysis",
    description: "Presented in plain language — the evidence, the reasoning, the limitations, all visible, nothing hidden behind a single verdict.",
  },
] as const;

const STAGE_DELAY_MS = 450;

export default function ExplainableIntelligence() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState(-1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setActiveStage(STAGES.length - 1);
      return;
    }

    const node = sectionRef.current;
    if (!node) return;

    let timeouts: number[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          timeouts = STAGES.map((_, index) => window.setTimeout(() => setActiveStage(index), index * STAGE_DELAY_MS));
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return (
    <section ref={sectionRef} className="bg-ink-2 py-24 text-text">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">The Platform&apos;s Signature</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Explainable Intelligence</h2>
          <p className="mt-5 text-lg text-text-2">The same deterministic process behind every analysis — nothing invented, nothing hidden.</p>
        </div>

        <ol className="mt-16 grid gap-4 md:grid-cols-5">
          {STAGES.map((stage, index) => {
            const lit = index <= activeStage;
            return (
              <li key={stage.title} className="relative">
                <div
                  className={`h-full rounded-card border p-6 transition-all duration-500 ${
                    lit ? "border-gold bg-ink-3" : "border-border bg-ink-2 opacity-40"
                  }`}
                >
                  <span className={`font-mono text-xs ${lit ? "text-gold-strong" : "text-text-3"}`}>0{index + 1}</span>
                  <h3 className="mt-2 text-lg font-semibold">{stage.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-text-2">{stage.description}</p>
                </div>
                {index < STAGES.length - 1 && (
                  <div
                    aria-hidden="true"
                    className={`absolute top-1/2 -right-2 hidden h-px w-4 -translate-y-1/2 transition-colors duration-500 md:block ${
                      lit ? "bg-gold" : "bg-border"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
