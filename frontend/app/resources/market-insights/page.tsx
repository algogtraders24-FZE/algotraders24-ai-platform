// app/resources/market-insights/page.tsx
// Market Insights: the archive of the automatically published market reports, grouped by report type.
// Same source as /blog (blogReaderService - only posts with a succeeded blog publishing job), so nothing appears here
// that is not live on the blog. Empty groups are not shown.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { blogReaderService } from "@/services/publishing/blog-reader.service";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Market Insights",
  description: "Daily, weekly, fundamental and economic-calendar market reports from Algotraders24 AI, backed by evidence and sources.",
  alternates: { canonical: "/resources/market-insights" },
};

const PER_GROUP = 6;

function prettyCategory(c: string): string {
  const t = c.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default async function MarketInsightsPage() {
  const posts = await blogReaderService.listPosts().catch(() => []);
  const groups = new Map<string, typeof posts>();
  for (const p of posts) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Resources / Market insights"
        title="Market reports"
        subtitle="Evidence-backed reports on the markets we cover - what is happening, what the data says, and what to watch."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-3xl space-y-12">
          {groups.size === 0 ? (
            <div className="rounded-panel border border-border bg-ink-2 p-8 text-center text-sm text-text-3">
              No reports have been published yet. Today&apos;s report appears here as soon as it is live.
            </div>
          ) : (
            [...groups.entries()].map(([category, list]) => (
              <div key={category}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{prettyCategory(category)}</h2>
                <ul className="mt-4 space-y-3">
                  {list.slice(0, PER_GROUP).map((post) => (
                    <li key={post.slug}>
                      <Link href={`/blog/${post.slug}`} className="block rounded-panel border border-border bg-ink-2 p-5 transition hover:border-gold/40">
                        <h3 className="text-lg font-semibold">{post.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-text-2">{post.excerpt}</p>
                        <p className="mt-2 text-xs text-text-3">
                          {new Date(post.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          <p className="text-center text-sm text-text-2">
            Every report on the{" "}
            <Link href="/blog" className="text-gold underline-offset-4 hover:underline">
              blog
            </Link>
            . Live pages for each market are on{" "}
            <Link href="/markets" className="text-gold underline-offset-4 hover:underline">
              Markets
            </Link>
            ; how the numbers are made is on{" "}
            <Link href="/methodology" className="text-gold underline-offset-4 hover:underline">
              Methodology
            </Link>
            . Reports are informational, not trading advice.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
