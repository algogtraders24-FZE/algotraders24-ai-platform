// app/company/careers/page.tsx
// Careers: open roles and the roles we expect to open later (lib/content/careers.ts). No JobPosting structured data on purpose:
// the pay and roles are indicative and Google requires exact, current details.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { APPLY_EMAIL, FUTURE_ROLES, OPEN_ROLES, type OpenRole } from "@/lib/content/careers";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Join Algotraders24 AI. Open roles: Full-Stack Engineer, Growth and Community Manager, Support and Operations Associate. Remote, India, paid in USD.",
  alternates: { canonical: "/company/careers" },
};

function applyHref(role: string): string {
  return `mailto:${APPLY_EMAIL}?subject=${encodeURIComponent(`Application: ${role}`)}`;
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="mt-5">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-text-2">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Role({ role }: { role: OpenRole }) {
  return (
    <details id={role.id} className="group rounded-card border border-border bg-ink-2 p-6 open:border-gold/40">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <span>
          <span className="block text-lg font-semibold">{role.title}</span>
          <span className="mt-1 block text-sm text-text-2">{role.summary}</span>
          <span className="mt-3 block text-xs leading-5 text-text-3">
            {role.location} · {role.type}
          </span>
          <span className="mt-1 block text-xs font-semibold text-gold">{role.pay}</span>
        </span>
        <span aria-hidden="true" className="mt-1 text-gold transition-transform group-open:rotate-45">
          +
        </span>
      </summary>

      <List title="What you will do" items={role.responsibilities} />
      <List title="What we need" items={role.musts} />
      <List title="Nice to have" items={role.nice} />

      <div className="mt-5">
        <h4 className="text-sm font-semibold">Your first 90 days</h4>
        <ol className="mt-2 space-y-2 text-sm leading-6 text-text-2">
          {role.first90.map((s) => (
            <li key={s.when}>
              <span className="font-semibold text-text">{s.when}. </span>
              {s.goal}
            </li>
          ))}
        </ol>
      </div>

      <a href={applyHref(role.title)} className="mt-6 inline-block text-sm font-semibold text-gold underline-offset-4 hover:underline">
        Apply for this role
      </a>
    </details>
  );
}

export default function CareersPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Company / Careers"
        title="Help us build trusted trading intelligence"
        subtitle="A small team that tests its own claims and publishes the results. We are hiring our first people."
      />

      <section className="px-6 pt-8">
        <div className="mx-auto max-w-3xl space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Open roles</h2>
          {OPEN_ROLES.map((r) => (
            <Role key={r.id} role={r} />
          ))}
        </div>
      </section>

      <section className="px-6 pt-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">How we hire and work</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-text-2">
            <li>Send your CV or links to work you are proud of, and a few lines on why this role. Email {APPLY_EMAIL} with the role in the subject.</li>
            <li>A short call with the founder.</li>
            <li>A paid trial contract, paid monthly in USD. We both see how it works.</li>
            <li>If it goes well, a full-time role, with a written agreement that covers confidentiality and that the work belongs to the company.</li>
          </ol>
          <p className="mt-4 text-sm leading-6 text-text-2">
            All roles are remote and based in India. We hire on the work you can show, not on where you studied. We will never ask you to
            pay anything to be considered, and we only contact you from {APPLY_EMAIL}. We use what you send only to consider your application; see our{" "}
            <Link href="/company/privacy-policy" className="text-gold underline-offset-4 hover:underline">
              privacy policy
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Roles we expect to open later</h2>
          <p className="mt-3 text-sm leading-6 text-text-2">
            These are <span className="font-semibold text-text">not open today</span>. They follow our{" "}
            <Link href="/resources/roadmap" className="text-gold underline-offset-4 hover:underline">
              roadmap
            </Link>
            . If one is yours, tell us now and we will write to you when it opens.
          </p>
          <ul className="mt-4 divide-y divide-border rounded-card border border-border bg-ink-2">
            {FUTURE_ROLES.map((f) => (
              <li key={f.title} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:gap-6">
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="mt-1 text-sm text-text-2">{f.why}</p>
                </div>
                <p className="text-xs uppercase tracking-wide text-text-3 sm:text-right">{f.when}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-text-2">
            Do not see your role?{" "}
            <a href={applyHref("Future role")} className="font-semibold text-gold underline-offset-4 hover:underline">
              Tell us who you are
            </a>
            .
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
