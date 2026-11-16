// app/solutions/institutions/page.tsx
// Services for institutions: brokers, wealth and fintech platforms (B2B). Every offer is a pilot or coming - nothing here is for sale off the shelf -
// and the page leads with proof a buyer can check on their own (calibration, methodology, research that includes failures). No client names,
// no pricing, no return claims: the first step is a pilot request by email. Content lives in lib/content/institutions.ts.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import { CONTACT_EMAIL } from "@/lib/company";
import { STATUS_LABEL, type ServiceStatus } from "@/lib/content/prop-firms";
import {
  CHECK_OUR_WORK,
  INSTITUTION_GROUPS,
  INSTITUTION_LIMITS,
  INSTITUTION_PILOT_QUESTIONS,
  INSTITUTION_PILOT_STEPS,
} from "@/lib/content/institutions";

export const metadata: Metadata = {
  title: "For Brokers and Platforms",
  description:
    "Evidence-based market context for brokers and platforms: a calibrated typical-move range per instrument, white-label reports, an evidence-grounded AI assistant and strategy-provider vetting. Pilot basis.",
  alternates: { canonical: "/solutions/institutions" },
};

const TONE: Record<ServiceStatus, BadgeTone> = { available: "success", pilot: "gold", coming: "neutral" };

function pilotHref(): string {
  const body = ["Hello,", "", "We would like to discuss a pilot with Algotraders24 AI.", "", ...INSTITUTION_PILOT_QUESTIONS, "", "Thank you."].join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Broker / platform pilot request")}&body=${encodeURIComponent(body)}`;
}

export default function InstitutionsPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Solutions / Brokers and platforms"
        title="Market context your clients can check"
        subtitle="Evidence, risk and confidence with the limits stated, not signals. We work on a pilot basis, and we say plainly what exists today and what is built with the first partner."
      />

      <section className="px-6 pt-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Check our work first</h2>
          <p className="mt-3 text-sm leading-6 text-text-2">Before you talk to us, read how we measure ourselves. It is all public.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {CHECK_OUR_WORK.map((c) => (
              <Link key={c.href} href={c.href} className="block rounded-card border border-border bg-ink-2 p-5 transition hover:border-gold/40">
                <h3 className="text-base font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm leading-6 text-text-2">{c.detail}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-12">
          {INSTITUTION_GROUPS.map((g) => (
            <div key={g.id}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{g.heading}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {g.services.map((s) => (
                  <Card key={s.title} padding="lg" className="flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-semibold">{s.title}</h3>
                      <Badge tone={TONE[s.status]} className="shrink-0 normal-case">{STATUS_LABEL[s.status]}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-text-2">{s.detail}</p>
                    <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-text-3">
                      <span className="font-semibold text-text-2">Today: </span>
                      {s.today}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-4">
        <div className="mx-auto max-w-4xl rounded-card border border-border bg-ink-2/60 p-6">
          <h2 className="text-base font-semibold">What to know before we start</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
            {INSTITUTION_LIMITS.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">How a pilot works</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {INSTITUTION_PILOT_STEPS.map((s, i) => (
              <li key={s.title}>
                <Card padding="md" className="h-full">
                  <p className="text-sm font-semibold text-gold">Step {i + 1}</p>
                  <h3 className="mt-1 text-base font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-text-2">{s.detail}</p>
                </Card>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-col items-start gap-3 rounded-card border border-gold/30 bg-gold/5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-semibold">Interested in a pilot?</p>
              <p className="mt-1 text-sm text-text-2">Send us a short email with your setup. No sign-up, and nothing is sold on this page.</p>
            </div>
            <a href={pilotHref()} className="inline-flex shrink-0 items-center rounded-control bg-gold px-5 py-2.5 text-sm font-semibold text-ink hover:bg-gold-strong">
              Request a pilot
            </a>
          </div>

          <p className="mt-8 text-xs leading-5 text-text-3">
            Everything here is informational and is not investment advice, research or a recommendation. Figures are not guarantees. We do not name clients.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
