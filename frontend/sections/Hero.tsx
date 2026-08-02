// sections/Hero.tsx
// Sprint H1.3 - Rebuilt per the approved Sprint H1.2A/H1.2B specifications.
// No fake dashboard, no fake AI output, no fake market data: the proof
// panel shows the real, true shape of the deterministic pipeline
// (evidence -> reasoning -> risk -> confidence -> explained) instead of an
// invented confidence score or claim - every label here is a fact about
// the architecture itself, not a fabricated analysis result.
//
// Sprint H1.7 - "Premium Hero Experience": added a purely decorative
// ambient glow (aria-hidden, no data implication) and extracted the proof
// panel into components/hero/PipelineProofPanel.tsx, which adds one small,
// honest motion touch (see that file's header) plus a real link to
// /dashboard/market-intelligence, now that Sprint L2.1 wired it to a real
// analysis. Hero itself stays a Server Component - only the one child that
// needs interactivity is client-side.
import Link from "next/link";
import PipelineProofPanel from "@/components/hero/PipelineProofPanel";

export default function Hero() {
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden bg-ink pt-20 text-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-gold/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-56 -left-32 h-[28rem] w-[28rem] rounded-full bg-steel/10 blur-3xl"
      />
      <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 md:grid-cols-2">
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
              href="/signup"
              className="rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold"
            >
              Start Free
            </Link>
          </div>

          <p className="hero-fade mt-4 text-sm text-text-3" style={{ animationDelay: "300ms" }}>
            Free plan included — explainable analysis from day one.
          </p>
        </div>

        {/* Right side: the real pipeline, framed as the product screen it
            actually drives — an app-window chrome around the honest pipeline
            preview (no fabricated dashboard, no invented market output). */}
        <div className="hero-fade flex justify-center" style={{ animationDelay: "320ms" }}>
          <div className="w-full max-w-md overflow-hidden rounded-panel border border-border bg-ink-2/70 shadow-raised backdrop-blur">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span aria-hidden="true" className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-steel/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-steel/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-gold/50" />
              </span>
              <span className="text-xs font-medium text-text-2">Market Intelligence</span>
              <span className="ml-auto rounded-control border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                Preview
              </span>
            </div>
            <div className="p-6">
              <PipelineProofPanel />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
