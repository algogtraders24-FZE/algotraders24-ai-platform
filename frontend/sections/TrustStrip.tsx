// sections/TrustStrip.tsx
// Sprint H1.5 - three real, verifiable-in-principle statements about how the
// platform itself is built. No customer counts, no partner logos, no
// borrowed trust: the strip earns credibility from the platform's own
// architecture, not from claims about who else uses it. Server Component:
// static content, no interactivity needed.
import { Repeat2, Link2, ShieldAlert } from "lucide-react";

const PRINCIPLES = [
  {
    icon: Repeat2,
    title: "Deterministic by design",
    description: "The same evidence produces the same analysis, every time — no randomness dressed up as insight.",
  },
  {
    icon: Link2,
    title: "Evidence-linked",
    description: "Every claim traces back to a real, attributed source — never asserted without something behind it.",
  },
  {
    icon: ShieldAlert,
    title: "Risk, never hidden",
    description: "Every analysis discloses its own limitations and uncertainty, not just a number that sounds confident.",
  },
] as const;

export default function TrustStrip() {
  return (
    <section className="border-y border-border bg-ink-2 py-14 text-text">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title} className="flex items-start gap-4">
              <principle.icon className="mt-1 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-text">{principle.title}</h3>
                <p className="mt-1 text-sm leading-6 text-text-2">{principle.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
