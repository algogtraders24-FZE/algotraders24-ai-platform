// sections/WhyTraditionalTradingFails.tsx
// Sprint H1.4 Phase 3 - problem-first narrative, each problem paired
// immediately with how the real, deterministic pipeline addresses it.
// A plain <ul>, not an <ol>: these five problems are a parallel set, not
// a sequence - numbered markers would encode an order that doesn't exist.
// Server Component: static content, no interactivity needed.
const PROBLEMS = [
  {
    problem: "Information overload",
    detail: "Ten tabs, five indicators, and a news feed that never stops — by the time you've read it all, the moment has passed.",
    solution:
      "Evidence Fusion collects, deduplicates, and ranks evidence from every source before it ever reaches you.",
  },
  {
    problem: "Conflicting analysis",
    detail: "One indicator says buy. Another says sell. Nothing tells you why they disagree.",
    solution:
      "The Reasoning Engine classifies evidence as supporting, opposing, or unresolved — disagreement is surfaced, never averaged away.",
  },
  {
    problem: "Hidden risk",
    detail: "A single \"risk score\" that never explains what it's actually measuring.",
    solution: "Risk is assessed across eight distinct categories, every time — never one vague number standing in for all of them.",
  },
  {
    problem: "No transparency",
    detail: "A signal appears. No evidence, no reasoning, no way to check it yourself.",
    solution:
      "Explainable Analysis shows the reasoning behind every conclusion — the evidence, the confidence, and what still isn't known.",
  },
  {
    problem: "Fragmented tools",
    detail: "A charting tool, a news feed, a risk calculator, and a chatbot — none of them talking to each other.",
    solution: "One deterministic pipeline — evidence, reasoning, risk, and confidence — working together as a single system.",
  },
] as const;

export default function WhyTraditionalTradingFails() {
  return (
    <section className="bg-ink-2 py-24 text-text">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Why Traditional Trading Fails</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">The problem isn't more data</h2>
          <p className="mt-5 text-lg text-text-2">It's data with no evidence, no reasoning, and no way to check it.</p>
        </div>

        <ul className="mt-16 space-y-6">
          {PROBLEMS.map((item) => (
            <li key={item.problem} className="rounded-card border border-border bg-ink p-8">
              <div className="border-l-2 border-signal-down/60 pl-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-down">{item.problem}</p>
                <p className="mt-2 text-sm leading-6 text-text-2">{item.detail}</p>
              </div>
              <div className="mt-5 border-l-2 border-gold pl-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">How Algotraders24 AI solves this</p>
                <p className="mt-2 text-sm leading-6 text-text">{item.solution}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
