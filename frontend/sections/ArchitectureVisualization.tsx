"use client";

// sections/ArchitectureVisualization.tsx
// Sprint H1.5 - the homepage's second "wow moment," deliberately different
// from Explainable Intelligence above it. That section is the simplified,
// five-stage version for a general audience; this one is the expanded,
// seven-stage technical trace for an institutional or technical evaluator
// deciding whether to trust the engineering - each stage names the real
// service file that implements it (verified against the actual services/ai
// and lib/market-data trees, not invented). A vertical trace with a
// connecting line that fills in sequence as each stage lights up: the data
// really does flow through these stages in this order, so the animation
// represents something true rather than decorating an arbitrary list.
// Plays once on scroll into view; respects prefers-reduced-motion.
//
// Sprint H1.7 - added a one-shot glow pulse (.animate-stage-pulse, in
// globals.css) on whichever marker is lighting up at that instant, for a
// more premium feel without adding anything that isn't already true.
import { useEffect, useRef, useState } from "react";

const STAGES = [
  {
    file: "lib/market-data/providers/alpha-vantage.provider.ts",
    title: "Market data ingestion",
    description: "Real-time price and news data pulled from external providers, normalized into a common evidence shape.",
  },
  {
    file: "services/ai/evidence-fusion.service.ts",
    title: "Evidence fusion",
    description: "Evidence from every source is deduplicated and merged before ranking ever begins.",
  },
  {
    file: "services/ai/evidence/evidence-ranking.service.ts",
    title: "Evidence ranking",
    description: "Remaining evidence is scored and ordered by relevance and source reliability.",
  },
  {
    file: "services/ai/reasoning/reasoning-engine.service.ts",
    title: "Reasoning",
    description: "Each item is classified as supporting, opposing, or unresolved — disagreement is surfaced, not smoothed over.",
  },
  {
    file: "services/ai/risk/risk-engine.service.ts",
    title: "Risk assessment",
    description: "Assessed across eight distinct categories, every time — never collapsed into one score.",
  },
  {
    file: "services/ai/confidence/confidence-engine.service.ts",
    title: "Confidence scoring",
    description: "Scored from how much real evidence exists and how well it agrees, not invented to sound authoritative.",
  },
  {
    file: "services/ai/explainable/explainable-analysis.service.ts",
    title: "Explainable output",
    description: "Everything above is composed into one transparent, human-readable analysis — nothing hidden behind a verdict.",
  },
] as const;

const STAGE_DELAY_MS = 320;

export default function ArchitectureVisualization() {
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
      { threshold: 0.2 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return (
    <section ref={sectionRef} className="bg-ink-2 py-16 text-text md:py-24">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Architecture</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">How an analysis actually happens</h2>
          <p className="mt-5 text-lg text-text-2">
            The same seven services, in the same order, every time — the real pipeline, not a simplified diagram.
          </p>
        </div>

        <ol className="mt-16">
          {STAGES.map((stage, index) => {
            const lit = index <= activeStage;
            const connectorFilled = index < activeStage;
            const isLast = index === STAGES.length - 1;
            return (
              <li key={stage.file} className="relative flex gap-6 pb-10 last:pb-0">
                <div className="flex w-6 shrink-0 flex-col items-center">
                  <span
                    className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[10px] transition-colors duration-500 ${
                      lit ? "border-gold bg-gold text-ink" : "border-border bg-ink-3 text-text-3"
                    }`}
                  >
                    {index === activeStage && (
                      <span key={activeStage} aria-hidden="true" className="absolute inset-0 rounded-full animate-stage-pulse" />
                    )}
                    {index + 1}
                  </span>
                  {!isLast && (
                    <span aria-hidden="true" className="relative mt-1 w-px flex-1 overflow-hidden bg-border">
                      <span
                        className={`absolute inset-x-0 top-0 w-px bg-gold transition-transform duration-500 ease-out ${
                          connectorFilled ? "h-full scale-y-100" : "h-full scale-y-0"
                        }`}
                        style={{ transformOrigin: "top" }}
                      />
                    </span>
                  )}
                </div>

                <div
                  className={`flex-1 pb-2 transition-opacity duration-500 ${lit ? "opacity-100" : "opacity-40"}`}
                >
                  <p className="font-mono text-xs text-text-3">{stage.file}</p>
                  <h3 className="mt-1.5 text-lg font-semibold">{stage.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-text-2">{stage.description}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 border-t border-border pt-6 text-center text-sm text-text-3">
          Orchestrated end-to-end by a single deterministic pipeline service — no step skipped, no order changed.
        </p>
      </div>
    </section>
  );
}
