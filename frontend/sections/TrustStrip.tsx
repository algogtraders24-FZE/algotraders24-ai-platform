// sections/TrustStrip.tsx
// Sprint H1.5 - three real, verifiable-in-principle statements about how the
// platform itself is built. No customer counts, no partner logos, no
// borrowed trust: the strip earns credibility from the platform's own
// architecture, not from claims about who else uses it. Server Component:
// static content, no interactivity needed.
//
// Sprint D2.1 (Phase 4) - extended to five trust pillars, each still an
// architecture-true property (no invented guarantee). A requested sixth
// pillar, "Privacy First", was deliberately NOT added: there is no privacy
// policy or data-handling statement anywhere in the codebase to substantiate
// it, and fabricating one would violate the same no-invention standard this
// strip exists to demonstrate. It can be added the moment a real privacy
// stance is documented.
import { Repeat2, Link2, ShieldAlert, Eye, Boxes } from "lucide-react";

const PILLARS = [
  {
    icon: Eye,
    title: "Explainable AI",
    description: "The model only restates a computed result in plain language — it never adds a fact or conclusion of its own.",
  },
  {
    icon: Link2,
    title: "Evidence-Based",
    description: "Every claim carries an attributed source and timestamp — no step outputs an assertion with nothing behind it.",
  },
  {
    icon: ShieldAlert,
    title: "Risk-Aware",
    description: "Risk is assessed across eight categories and reported as the worst — never blended into one reassuring number.",
  },
  {
    icon: Repeat2,
    title: "Deterministic",
    description: "The same evidence produces the same analysis, every time — re-running verifies it, never reshuffles it.",
  },
  {
    icon: Boxes,
    title: "Enterprise Architecture",
    description: "One orchestrated pipeline of named services, in the same order every run — built to be audited, not trusted on faith.",
  },
] as const;

export default function TrustStrip() {
  return (
    <section className="border-y border-border bg-ink-2 py-14 text-text">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="flex flex-col gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                <pillar.icon className="h-5 w-5 text-gold" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">{pillar.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-text-2">{pillar.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
