// app/solutions/prop-firms/page.tsx
// Services for prop firms (B2B). The page lists only what is real today and labels the rest honestly (lib/content/prop-firms.ts).
// No firm names or logos, no promise about trader results, no pricing: the first step is a pilot request by email.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import { CONTACT_EMAIL } from "@/lib/company";
import { NOT_WHAT_WE_DO, PILOT_QUESTIONS, PILOT_STEPS, SERVICE_GROUPS, STATUS_LABEL, type ServiceStatus } from "@/lib/content/prop-firms";

export const metadata: Metadata = {
  title: "For Prop Firms",
  description:
    "Evidence and analytics services that sit next to a prop firm's stack: rule monitoring, consistency checks, applicant and EA screening, risk reports and a risk-context feed.",
  alternates: { canonical: "/solutions/prop-firms" },
};

const TONE: Record<ServiceStatus, BadgeTone> = { available: "success", pilot: "gold", coming: "neutral" };

function pilotHref(): string {
  const body = ["Hello,", "", "We would like to discuss a pilot with Algotraders24 AI.", "", ...PILOT_QUESTIONS, "", "Thank you."].join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Prop firm pilot request")}&body=${encodeURIComponent(body)}`;
}

export default function PropFirmsPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Solutions / Prop firms"
        title="Evidence and analytics, next to your stack"
        subtitle="Monitor rules, screen applicants and EAs, and read each trader's risk. We do not replace your platform, and we say plainly what works today and what does not."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-12">
          {SERVICE_GROUPS.map((g) => (
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
          <h2 className="text-base font-semibold">What we do not do</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
            {NOT_WHAT_WE_DO.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">How a pilot works</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {PILOT_STEPS.map((s, i) => (
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
            Figures come from closed trades reported by the trader&apos;s own terminal and are not verified by a broker. Everything here is informational
            measurement, not investment advice, and not a statement of any firm&apos;s rules. Monitoring is only ever done with the trader&apos;s own consent.
            We are not affiliated with any prop firm.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
