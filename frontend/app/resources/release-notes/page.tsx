// app/resources/release-notes/page.tsx
// "What's new": a dated, plain-language list of what has shipped (lib/content/release-notes.ts).
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";
import { RELEASE_NOTES } from "@/lib/content/release-notes";

export const metadata: Metadata = {
  title: "Release Notes",
  description: "What is new in Algotraders24 AI - dated, plain-language notes on everything we ship.",
  alternates: { canonical: "/resources/release-notes" },
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function ReleaseNotesPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Resources / Release notes" title="What's new" subtitle="Everything we ship, in plain language. Newest first." />
      <section className="px-6 py-12">
        <ol className="mx-auto max-w-3xl space-y-6">
          {RELEASE_NOTES.map((release) => (
            <li key={release.date}>
              <Card padding="lg">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{formatDate(release.date)}</p>
                <h2 className="mt-2 text-xl font-semibold">{release.title}</h2>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
                  {release.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-5 text-text-3">
          Notes list features that are live for everyone. Anything still being prepared is added once it is available.
        </p>
      </section>
      <Footer />
    </main>
  );
}
