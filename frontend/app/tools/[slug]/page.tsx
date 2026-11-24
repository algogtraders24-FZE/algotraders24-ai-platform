// app/tools/[slug]/page.tsx
// Free public calculators (no login): position size, pip value, risk reward, drawdown recovery. Arithmetic only, education wording.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { DrawdownRecoveryCalculator, PipValueCalculator, PositionSizeCalculator, RiskRewardCalculator } from "@/components/tools/Calculators";
import { TOOL_PAGES, getToolPage } from "@/lib/tools/pages";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";

export function generateStaticParams() {
  return TOOL_PAGES.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = getToolPage((await params).slug);
  if (!t) return {};
  return {
    title: t.title,
    description: t.description,
    alternates: { canonical: `/tools/${t.slug}` },
    openGraph: { title: t.title, description: t.description, url: `/tools/${t.slug}`, type: "website" },
  };
}

function Calculator({ slug }: { slug: string }) {
  switch (slug) {
    case "position-size-calculator": return <PositionSizeCalculator />;
    case "pip-value-calculator": return <PipValueCalculator />;
    case "risk-reward-calculator": return <RiskRewardCalculator />;
    case "drawdown-recovery-calculator": return <DrawdownRecoveryCalculator />;
    default: return null;
  }
}

const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const t = getToolPage((await params).slug);
  if (!t) notFound();
  const others = TOOL_PAGES.filter((o) => o.slug !== t.slug);
  const app = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: t.title,
    description: t.description,
    url: `${SITE_URL}/tools/${t.slug}`,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: t.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(app) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faq) }} />
      <PageHero eyebrow="Free tool" title={t.title} subtitle={t.intro} />
      <section className="px-6 pb-16 pt-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <Calculator slug={t.slug} />

          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">How it is calculated</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-text-2">
              {t.how.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">Questions</h2>
            <div className="mt-3 space-y-4">
              {t.faq.map((f) => (
                <div key={f.q}>
                  <h3 className="font-medium text-text">{f.q}</h3>
                  <p className="mt-1 leading-7 text-text-2">{f.a}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-panel border border-gold/40 bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">Go further, free</h2>
            <p className="mt-2 leading-7 text-text-2">
              Open the Pro Chart, the Swing Lab position planner and the daily market reports in your dashboard. A free login is all you need.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-control bg-gold px-5 py-2 text-sm font-semibold text-ink transition hover:brightness-110">Start free</Link>
              <Link href="/blog" className="rounded-control border border-border px-5 py-2 text-sm font-semibold text-text-2 transition hover:text-text">Read today&apos;s market reports</Link>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-3">More free tools</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {others.map((o) => (
                <li key={o.slug}>
                  <Link href={`/tools/${o.slug}`} className="block rounded-lg border border-border bg-ink-2 px-4 py-3 text-sm text-text-2 transition hover:border-gold hover:text-text">
                    {o.short}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-6 text-text-3">
            General education and arithmetic only, not financial advice. Results depend on the numbers you enter; check contract sizes and conditions with your broker. Trading involves risk and many traders lose money.
          </p>
        </div>
      </section>
      <Footer />
    </main>
  );
}
