// app/blog/page.tsx
// AT24 Publishing Engine (P2.5) - the public blog index. Server Component.
// Lists only Articles with a SUCCEEDED INTERNAL_BLOG publishing job
// (blogReaderService) - never `Article.status`.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { blogReaderService } from "@/services/publishing/blog-reader.service";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Blog",
  description: "Evidence-backed market analysis and research from Algotraders24 AI.",
  alternates: { canonical: "/blog" },
};

function prettyCategory(c: string): string {
  return c.replace(/-/g, " ");
}

export default async function BlogIndexPage() {
  const posts = await blogReaderService.listPosts();

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Algotraders24"
        title="Blog"
        subtitle="Evidence-backed market analysis, moved through a real publishing lifecycle."
      />
      <section className="px-6 pb-16 pt-4">
        <div className="mx-auto max-w-3xl">
          {posts.length === 0 ? (
            <div className="rounded-panel border border-border bg-ink-2 p-8 text-center text-sm text-text-3">
              No articles have been published yet.
            </div>
          ) : (
            <ul className="space-y-4">
              {posts.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="block rounded-panel border border-border bg-ink-2 p-6 transition hover:border-gold/40"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-3">
                      {prettyCategory(post.category)}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-text">{post.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-text-2">{post.excerpt}</p>
                    <p className="mt-3 text-xs text-text-3">
                      {new Date(post.publishedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <Footer />
    </main>
  );
}
