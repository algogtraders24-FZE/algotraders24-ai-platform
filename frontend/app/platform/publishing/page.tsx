// app/platform/publishing/page.tsx
// Sprint D2.4.A1 - assembled from sections/PlatformModules.tsx's Publishing
// card, the only existing source for this module, per the approved D2.4.A1
// IA plan. Deliberately short - padding it with invented detail would
// violate the same no-fabrication standard the rest of this site holds to.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import PlatformCTA from "@/components/marketing/PlatformCTA";

export const metadata: Metadata = {
  title: "Publishing",
  description: "Turn a finished analysis into a scored, scheduled, publishable write-up — analysis made shareable.",
  alternates: { canonical: "/platform/publishing" },
};

export default function PublishingPlatformPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Platform / Publishing"
        title="Analysis, made shareable"
        subtitle="Turn a finished analysis into a scored, scheduled, publishable write-up."
      />
      <section className="px-6 py-12">
        <div className="mx-auto max-w-3xl rounded-panel border border-border bg-ink-2 p-8 text-center">
          <p className="text-sm leading-7 text-text-2">
            Publishing takes the same evidence-backed analysis the rest of the platform produces and moves it through
            a real draft → schedule → publish lifecycle, with an SEO score and a full history log — not a copy-paste
            step bolted on afterward.
          </p>
        </div>
      </section>
      <PlatformCTA dashboardHref="/dashboard/publishing" dashboardLabel="Open Publishing" />
      <Footer />
    </main>
  );
}
