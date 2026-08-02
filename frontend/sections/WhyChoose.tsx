// sections/WhyChoose.tsx
// Sprint D2.1 (Phase 8) - "Why Choose Algotraders24 AI": a clean side-by-side
// that replaces the older WhyTraditionalTradingFails section (same
// traditional-vs-us message, but as a scannable comparison rather than a
// second long problem/solution list). Every left-column item is a truthful,
// non-strawman problem with manual trading; every right-column item is a
// property of the real architecture (traceable to the pipeline described
// elsewhere on this page and in services/ai) - no exaggeration, no invented
// capability. Server Component: static content, no interactivity needed.
import { X, Check } from "lucide-react";

const TRADITIONAL = [
  { label: "Multiple disconnected tools", detail: "A chart here, a news feed there, a chatbot somewhere else — none aware of each other." },
  { label: "Manual research", detail: "Hours spent gathering and cross-checking sources by hand." },
  { label: "Information overload", detail: "More data than anyone can read before the moment has passed." },
  { label: "Emotional decisions", detail: "Fear and FOMO fill the gap where evidence should be." },
  { label: "Limited context", detail: "A number with no reasoning behind it and no way to check it." },
  { label: "Time-consuming analysis", detail: "Every question starts over from a blank page." },
] as const;

const PLATFORM = [
  { label: "Unified AI Trading Intelligence", detail: "One deterministic pipeline feeds every module — not eight disconnected tools." },
  { label: "Explainable AI", detail: "The model restates an already-computed result; it never invents one." },
  { label: "Evidence-Based Analysis", detail: "Every claim carries an attributed source and a timestamp." },
  { label: "Risk-Aware Decision Support", detail: "Risk across eight categories, disclosed — decision support, not signals." },
  { label: "Research-Centric Workflow", detail: "Assistant, Knowledge Base, and Market Intelligence share one evidence layer." },
  { label: "Institutional Architecture", detail: "Deterministic, named services, in the same order on every run." },
] as const;

export default function WhyChoose() {
  return (
    <section className="bg-ink-2 py-16 text-text md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">The Difference</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Why choose Algotraders24 AI</h2>
          <p className="mt-5 text-lg text-text-2">
            The same market, approached two ways — fragmented and manual, or unified and explainable.
          </p>
        </div>

        <div className="relative mt-16 grid gap-6 md:grid-cols-2">
          {/* Traditional trading */}
          <div className="rounded-panel border border-border bg-ink p-8">
            <h3 className="text-xl font-semibold text-text-2">Traditional Trading</h3>
            <ul className="mt-6 space-y-5">
              {TRADITIONAL.map((item) => (
                <li key={item.label} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-signal-down/40 bg-signal-down/10">
                    <X className="h-3.5 w-3.5 text-signal-down" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-text">{item.label}</p>
                    <p className="mt-0.5 text-sm leading-6 text-text-3">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Algotraders24 AI */}
          <div className="relative rounded-panel border border-gold/40 bg-ink p-8 shadow-raised">
            <span className="absolute -top-3 left-8 rounded-control border border-gold/40 bg-ink px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gold">
              The platform
            </span>
            <h3 className="text-xl font-semibold">Algotraders24 AI</h3>
            <ul className="mt-6 space-y-5">
              {PLATFORM.map((item) => (
                <li key={item.label} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
                    <Check className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-text">{item.label}</p>
                    <p className="mt-0.5 text-sm leading-6 text-text-2">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Center VS marker (desktop only) */}
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 hidden h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gold/40 bg-ink text-xs font-bold tracking-wider text-gold md:flex"
          >
            VS
          </span>
        </div>
      </div>
    </section>
  );
}
