// app/solutions/institutions/demo/page.tsx
// Prototype demo for brokers and platforms: shows, inside an illustrative client-portal frame, the Market Context widget with LIVE numbers from
// our public market hub. It is not a partner integration and not live at any broker; the page says so. Not indexed (a sales demo, not content).
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import MarketContextWidget from "@/components/institutions/MarketContextWidget";
import { CONTACT_EMAIL } from "@/lib/company";
import { marketBySlug } from "@/services/markets/hub";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Market Context widget demo",
  description: "A prototype of the Market Context widget for brokers and platforms, shown with live numbers inside an illustrative client portal.",
  alternates: { canonical: "/solutions/institutions/demo" },
  robots: { index: false, follow: true },
};

const SHOWN = ["gold", "eur-usd", "bitcoin"] as const;

export default function WidgetDemoPage() {
  const defs = SHOWN.map((s) => marketBySlug(s)).filter((d): d is NonNullable<typeof d> => !!d);
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Solutions / Brokers and platforms / Demo"
        title="The Market Context widget, in a client portal"
        subtitle="A prototype with live numbers. The frame below is illustrative: no broker uses this today, and a partner version would carry your branding and your own keys."
      />

      <section className="px-6 pb-8 pt-4">
        <div className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-card border border-border">
            <div className="flex items-center justify-between border-b border-border bg-ink-2 px-5 py-3">
              <p className="text-sm font-semibold">
                Your Brokerage <span className="font-normal text-text-3">/ Client portal (illustrative)</span>
              </p>
              <p className="text-xs text-text-3">Markets today</p>
            </div>
            <div className="grid gap-4 bg-ink p-5 md:grid-cols-3">
              {defs.map((d) => (
                <MarketContextWidget key={d.slug} def={d} />
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-text-3">
            Numbers are live from our public market pages and refresh about every 10 minutes. They are the same numbers anyone can read at{" "}
            <Link href="/markets" className="text-gold hover:underline">/markets</Link>.
          </p>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-border bg-ink-2 p-5">
            <h2 className="text-base font-semibold">What this prototype shows</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
              <li>
                A typical-move range per instrument, with the result of checking it afterwards (see the{" "}
                <Link href="/calibration" className="text-gold hover:underline">scoreboard</Link>).
              </li>
              <li>Key levels, macro alignment and the next high-impact event, each with its limit stated.</li>
              <li>No signal, no buy or sell wording, no return figures.</li>
            </ul>
          </div>
          <div className="rounded-card border border-border bg-ink-2 p-5">
            <h2 className="text-base font-semibold">What it is not yet</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
              <li>Not an embeddable, partner-keyed widget or API. That is built with the first partner.</li>
              <li>Not branded, translated or checked against your data licences. Which market data may be shown to your clients is agreed with you first.</li>
              <li>Ranges were tested on Gold and Bitcoin only. Other instruments use those settings untested.</li>
            </ul>
          </div>
        </div>

        <div className="mx-auto mt-8 flex max-w-4xl flex-col items-start gap-3 rounded-card border border-gold/30 bg-gold/5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold">Want this for your clients?</p>
            <p className="mt-1 text-sm text-text-2">
              Read the <Link href="/solutions/institutions" className="text-gold hover:underline">full offer and limits</Link>, then email us your setup.
            </p>
          </div>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Market Context widget pilot")}`}
            className="inline-flex shrink-0 items-center rounded-control bg-gold px-5 py-2.5 text-sm font-semibold text-ink hover:bg-gold-strong"
          >
            Request a pilot
          </a>
        </div>
      </section>
      <Footer />
    </main>
  );
}
