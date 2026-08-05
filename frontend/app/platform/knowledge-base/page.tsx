// app/platform/knowledge-base/page.tsx
// Sprint D2.4.A1 - assembled from sections/PlatformOverview.tsx's "Knowledge
// Base" card, per the approved D2.4.A1 IA plan.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import PlatformCTA from "@/components/marketing/PlatformCTA";

export const metadata: Metadata = {
  title: "Knowledge Base",
  description: "A searchable, retrieval-augmented knowledge layer the AI Assistant draws on for grounded answers — built on real documents.",
  alternates: { canonical: "/platform/knowledge-base" },
};

export default function KnowledgeBasePlatformPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Platform / Knowledge Base"
        title="A grounded layer, not a guess"
        subtitle="A searchable, retrieval-augmented knowledge layer the Assistant draws on for grounded answers — built on real documents, not improvised from memory."
      />
      <section className="px-6 py-12">
        <div className="mx-auto max-w-3xl rounded-panel border border-border bg-ink-2 p-8 text-center">
          <p className="text-sm leading-7 text-text-2">
            Documents are chunked, embedded, and retrieved with vector similarity search — the same store the{" "}
            <Link href="/platform/assistant" className="text-gold hover:text-gold-strong">
              AI Assistant
            </Link>{" "}
            queries before it answers anything. If nothing relevant is indexed, the Assistant says so rather than
            guessing.
          </p>
        </div>
      </section>
      <PlatformCTA dashboardHref="/dashboard/knowledge" dashboardLabel="Open Knowledge Base" />
      <Footer />
    </main>
  );
}
