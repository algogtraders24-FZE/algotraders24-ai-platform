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
// panel into components/hero/PipelineProofPanel.tsx.
//
// Sprint D2.4.A5 - Visual Identity & Product Showcase. The single proof
// panel is replaced with HeroDashboardPreview: a real, unedited product
// screenshot as the centerpiece with two small floating proof cards - the
// "wow moment" the sprint asked for, built entirely from assets that
// already existed (no new screenshots were fabricated or invented). Hero
// itself stays a Server Component - only the preview composition needs
// interactivity (the auto-cycling pipeline card, the float animation).
import Link from "next/link";
import HeroDashboardPreview from "@/components/hero/HeroDashboardPreview";

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

        {/* Right side: a real, unedited product screenshot with two small
            floating proof cards - no fabricated dashboard, no invented
            market output. */}
        <div className="hero-fade flex justify-center" style={{ animationDelay: "320ms" }}>
          <HeroDashboardPreview />
        </div>
      </div>
    </section>
  );
}
