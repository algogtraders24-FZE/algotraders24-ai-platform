// sections/EnterpriseTrust.tsx
// Sprint H1.7 - "Enterprise Trust Section." Deliberately makes no claim
// about existing institutional clients, certifications, uptime, or audits
// - none of that exists yet, and inventing it would violate the platform's
// own no-fabrication standard on the section meant to demonstrate exactly
// that standard. Instead this earns institutional trust the only honest
// way available pre-launch: naming specific, verifiable properties of the
// real architecture (each one traceable to real code touched across
// 15D/L2.1) and explaining why each one matters to an evaluator who
// doesn't take vendor claims at face value. Server Component: static
// content, no interactivity needed.
const PROPERTIES = [
  {
    title: "Deterministic, not probabilistic",
    detail:
      "The same evidence produces the same analysis, every time it's run. Re-running an analysis is a way to verify it, not a way to get a different answer.",
  },
  {
    title: "Every claim is sourced",
    detail:
      "Nothing is asserted without an attributed source and a timestamp attached. There is no step in the pipeline that outputs a claim with no evidence behind it.",
  },
  {
    title: "Risk is disclosed, never averaged away",
    detail:
      "Risk is assessed across eight independent categories and reported as the worst of them — never blended into one reassuring number that hides which category is actually elevated.",
  },
  {
    title: "The AI restates. It never reasons.",
    detail:
      "The language model's only role is to phrase an already-computed, deterministic result in plain English. It is explicitly instructed never to add a fact, price, or conclusion that isn't already there — and never to change one.",
  },
] as const;

export default function EnterpriseTrust() {
  return (
    <section className="bg-ink-2 py-16 text-text md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">For Institutions</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Verify it. Don&apos;t just trust it.</h2>
          <p className="mt-5 text-lg text-text-2">
            No client logos, no certifications, no claimed track record — we don&apos;t have those yet, and won&apos;t
            pretend to. What we can show is how the system itself is built to be checked.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2">
          {PROPERTIES.map((property) => (
            <div key={property.title} className="rounded-card border border-border bg-ink p-8">
              <h3 className="text-lg font-semibold">{property.title}</h3>
              <p className="mt-3 text-sm leading-6 text-text-2">{property.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
