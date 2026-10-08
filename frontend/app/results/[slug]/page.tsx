// app/results/[slug]/page.tsx
// AT24 Live Results - public page. Public pages are open; unlisted pages need ?k=<secret>; private pages
// are visible to their owner only. Everything the visitor sees is produced by services/live-results/build.ts
// (privacy redaction happens there, server-side). v1 is noindex everywhere on purpose.
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ResultsView from "@/components/live-results/ResultsView";
import { loadResults } from "@/services/live-results/prisma-store";
import { getUserOrNull } from "@/lib/auth/protectedRoute";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Results | AT24",
  robots: { index: false, follow: false },
};

export default async function LiveResultsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string }> }) {
  const { slug } = await params;
  const { k } = await searchParams;
  const user = await getUserOrNull().catch(() => null);
  const res = await loadResults(slug, { userId: user ? user.profile.id : null, key: typeof k === "string" ? k : null, isAdmin: user?.profile.role === "admin" });
  if (res.state !== "ok") notFound();
  const note = res.isOwner && res.visibility !== "public" ? `You are viewing your own ${res.visibility} page. Visitors without access see a "not found" page.` : res.isAdmin && !res.isOwner && res.visibility !== "public" ? `Admin view of a ${res.visibility} page. Visitors without access see a "not found" page.` : null;

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <ResultsView r={res.results} ownerNote={note} />
      <Footer />
    </main>
  );
}
