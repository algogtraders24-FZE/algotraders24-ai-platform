// components/legal/LegalPageLayout.tsx
// Shared shell for the 5 legal pages (Privacy Policy, Terms of Service,
// Cookie Policy, Refund Policy, AML/KYC) - same card-per-section pattern
// app/company/disclaimer/page.tsx already established, extracted once
// since 5 near-identical pages is the real duplication problem, not the
// abstraction.
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export interface LegalSection {
  heading: string;
  body: string[]; // each entry renders as its own paragraph
}

export default function LegalPageLayout({
  eyebrow,
  title,
  lastUpdated,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  lastUpdated: string;
  intro?: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow={eyebrow} title={title} />

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-2xl space-y-6">
          <p className="text-center text-xs text-text-3">Last updated: {lastUpdated}</p>

          {intro && <p className="text-sm leading-7 text-text-2">{intro}</p>}

          {sections.map((section) => (
            <div key={section.heading} className="rounded-card border border-border bg-ink-2 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">{section.heading}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-sm leading-7 text-text-2">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-card border border-border bg-ink-3 p-6">
            <p className="text-xs leading-6 text-text-3">
              This policy was written and published directly by Algotraders24 AI and has not been reviewed by
              outside legal counsel. It is provided to be clear and genuinely followed, not as a substitute for
              independent legal advice. If you have a legal question about your specific situation, consult a
              licensed professional in your jurisdiction.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
