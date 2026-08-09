"use client";

// components/hero/PipelineProofPanel.tsx
// Sprint H1.7 - Extracted from Hero.tsx to add one small, honest motion
// touch: the stage list gently auto-cycles a highlight, looping - not
// because anything is "live" right now, but because the fact it's
// illustrating (the platform runs these same five stages, in this order,
// for every single analysis) is permanently and always true, unlike a
// fabricated "live activity" indicator would be. Hover/focus still works
// exactly as before via pure CSS (group-hover/group-focus-within) and
// takes visual precedence over the auto-cycle. Respects
// prefers-reduced-motion by disabling the cycle entirely and leaving the
// static hover/focus behavior as the only interaction.
//
// Sprint D2.4.A5 - optional `compact` prop for its new second home as a
// small floating card in HeroDashboardPreview: heading, per-stage detail
// tooltips, and the closing link all drop out, leaving just the five-pill
// auto-cycling row. Default (no prop) is the original full panel, still
// used as the Hero's own dominant visual before this sprint... now unused
// there but kept as the default shape in case another full-size use
// appears.
import { useEffect, useState } from "react";
import Link from "next/link";

const PIPELINE = [
  { label: "Evidence", detail: "Collected from real, attributed sources" },
  { label: "Reasoning", detail: "Classified as supporting, opposing, or unresolved" },
  { label: "Risk", detail: "Assessed across eight categories" },
  { label: "Confidence", detail: "Scored from real evidence, never guessed" },
  { label: "Explained", detail: "Presented in plain language — nothing hidden" },
] as const;

const CYCLE_MS = 2600;

export default function PipelineProofPanel({ compact }: { compact?: boolean } = {}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % PIPELINE.length);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, []);

  if (compact) {
    return (
      <div className="w-full">
        <p className="text-xs font-semibold text-text-2">How every analysis is built</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PIPELINE.map((stage, index) => (
            <span
              key={stage.label}
              className={`rounded-control border px-2.5 py-1 text-[11px] font-medium transition-colors duration-500 ${
                active === index ? "border-gold bg-ink-3 text-text" : "border-border bg-ink text-text-3"
              }`}
            >
              {stage.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    // Sprint D2.1 - the outer panel chrome now lives in Hero's app-window
    // frame; this component renders only the content that sits inside it.
    <div className="w-full">
      <h2 className="text-base font-semibold">How every analysis is built</h2>
      <p className="mt-1 text-sm text-text-3">The same deterministic process, every time.</p>

      <ol className="mt-6 space-y-3">
        {PIPELINE.map((stage, index) => (
          <li key={stage.label} className="group relative">
            <button
              type="button"
              onFocus={() => setActive(index)}
              onMouseEnter={() => setActive(index)}
              className={`flex w-full items-center gap-4 rounded-control border px-4 py-3 text-left transition-colors duration-500 focus-visible:border-gold ${
                active === index ? "border-gold bg-ink-3" : "border-border bg-ink-2 hover:border-gold"
              }`}
              aria-describedby={`stage-detail-${index}`}
            >
              <span className={`font-mono text-xs transition-colors duration-500 ${active === index ? "text-gold" : "text-gold-strong"}`}>
                0{index + 1}
              </span>
              <span className="font-medium text-text">{stage.label}</span>
            </button>
            <div
              id={`stage-detail-${index}`}
              role="tooltip"
              className="pointer-events-none absolute left-0 right-0 top-full z-10 mt-1 rounded-control border border-border bg-ink-3 px-3 py-2 text-xs text-text-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              {stage.detail}
            </div>
          </li>
        ))}
      </ol>

      <Link
        href="/dashboard/market-intelligence"
        className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-gold transition-colors hover:text-gold-strong"
      >
        See a real analysis run →
      </Link>
    </div>
  );
}
