// sections/Hero.tsx
// Sprint H1.3 - Rebuilt per the approved Sprint H1.2A/H1.2B specifications.
// No fake dashboard, no fake AI output, no fake market data: the proof
// panel shows the real, true shape of the deterministic pipeline
// (evidence -> reasoning -> risk -> confidence -> explained) instead of an
// invented confidence score or claim - every label here is a fact about
// the architecture itself, not a fabricated analysis result. Wiring a
// real, live analysis into this panel is explicit follow-up work for
// H1.4 (see the Sprint H1.3 report).
//
// Zero client-side JavaScript: the entrance stagger is a CSS animation
// with per-element animation-delay, and the pipeline tooltips use
// group-hover/group-focus-within - no useState/useEffect needed here.
import Link from "next/link";

const PIPELINE = [
  { label: "Evidence", detail: "Collected from real, attributed sources" },
  { label: "Reasoning", detail: "Classified as supporting, opposing, or unresolved" },
  { label: "Risk", detail: "Assessed across eight categories" },
  { label: "Confidence", detail: "Scored from real evidence, never guessed" },
  { label: "Explained", detail: "Presented in plain language — nothing hidden" },
] as const;

export default function Hero() {
  return (
    <section className="flex min-h-screen items-center bg-ink pt-20 text-text">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 md:grid-cols-2">
        {/* Left side */}
        <div>
          <span
            className="hero-fade inline-block rounded-control border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold"
            style={{ animationDelay: "0ms" }}
          >
            AI Trading Intelligence Platform
          </span>

          <h1
            className="hero-fade mt-6 font-display text-5xl font-medium leading-tight md:text-6xl"
            style={{ animationDelay: "80ms" }}
          >
            Market analysis that shows its work
          </h1>

          <p className="hero-fade mt-6 max-w-xl text-lg leading-8 text-text-2" style={{ animationDelay: "160ms" }}>
            Every conclusion traces to evidence you can see, a confidence score you can question, and a risk we
            never hide.
          </p>

          <div className="hero-fade mt-10 flex flex-wrap gap-4" style={{ animationDelay: "240ms" }}>
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

        {/* Right side: the real pipeline, not a fake output */}
        <div className="hero-fade flex justify-center" style={{ animationDelay: "320ms" }}>
          <div className="w-full max-w-md rounded-panel glass-surface p-8">
            <h2 className="text-lg font-semibold">How every analysis is built</h2>
            <p className="mt-1 text-sm text-text-3">The same deterministic process, every time.</p>

            <ol className="mt-6 space-y-3">
              {PIPELINE.map((stage, index) => (
                <li key={stage.label} className="group relative">
                  <button
                    type="button"
                    className="flex w-full items-center gap-4 rounded-control border border-border bg-ink-2 px-4 py-3 text-left transition-colors hover:border-gold focus-visible:border-gold"
                    aria-describedby={`stage-detail-${index}`}
                  >
                    <span className="font-mono text-xs text-gold-strong">0{index + 1}</span>
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
          </div>
        </div>
      </div>
    </section>
  );
}
