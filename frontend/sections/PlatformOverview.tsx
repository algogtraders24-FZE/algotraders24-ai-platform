// sections/PlatformOverview.tsx
// Sprint H1.4 Phase 2 - "What is Algotraders24 AI?" Four real capabilities,
// each labeled honestly: the AI Assistant and Knowledge Base are live,
// database-backed features today (app/dashboard/assistant,
// app/dashboard/knowledge); Market Intelligence and Explainable Analysis
// describe the real, extensively-validated deterministic pipeline built
// across Sprint 15D, rolling out across the platform - neither is
// overclaimed as already powering every dashboard page. No marketing
// exaggeration, no invented features. Server Component: no interactivity
// needed, so no client-side JavaScript ships for this section.
const CAPABILITIES = [
  {
    status: "Available today",
    title: "AI Assistant",
    description:
      "A conversational interface grounded in real evidence, not a generic chatbot. Ask a question in plain language and get an answer backed by the same reasoning the platform uses everywhere else.",
  },
  {
    status: "Available today",
    title: "Knowledge Base",
    description:
      "A searchable, retrieval-augmented knowledge layer the Assistant draws on for grounded answers - built on real documents, not improvised from memory.",
  },
  {
    status: "Engineered pipeline",
    title: "Market Intelligence",
    description:
      "Price and news evidence is collected, deduplicated, and reasoned about through a deterministic pipeline - evidence in, reasoning out, never a black-box prediction.",
  },
  {
    status: "Engineered pipeline",
    title: "Explainable Analysis",
    description:
      "Every analysis carries its supporting evidence, opposing evidence, stated limitations, a confidence score, and a risk level - nothing hidden behind a single number.",
  },
] as const;

export default function PlatformOverview() {
  return (
    <section className="bg-ink py-24 text-text">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Platform Overview</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">What is Algotraders24 AI?</h2>
          <p className="mt-5 text-lg text-text-2">
            Four real capabilities working from the same deterministic foundation — not four disconnected tools.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((capability) => (
            <div
              key={capability.title}
              className="rounded-card border border-border bg-ink-2 p-8 transition-colors hover:border-gold"
            >
              <span className="inline-block rounded-control border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
                {capability.status}
              </span>
              <h3 className="mt-5 text-xl font-semibold">{capability.title}</h3>
              <p className="mt-3 text-sm leading-6 text-text-2">{capability.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
