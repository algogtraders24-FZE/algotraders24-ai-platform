// app/blog/[slug]/page.tsx
// AT24 Publishing Engine (P2.5) - a public blog article. Server Component.
// Visible ONLY when blogReaderService.getPostBySlug returns a post (a
// SUCCEEDED INTERNAL_BLOG job whose content still matches the published
// version). Content is sanitized plain text; rendered as plain React text
// children - the reader never injects raw HTML.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Disclaimer from "@/components/ui/Disclaimer";
import { blogReaderService } from "@/services/publishing/blog-reader.service";

export const revalidate = 300;

export async function generateStaticParams() {
  const slugs = await blogReaderService.listSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await blogReaderService.getPostBySlug(slug);
  if (!post) {
    return { title: "Article not found", robots: { index: false, follow: false } };
  }
  const s = post.seo;
  return {
    title: s.title,
    description: s.description,
    keywords: s.keywords.length > 0 ? s.keywords : undefined,
    alternates: { canonical: s.canonicalUrl },
    openGraph: {
      title: s.ogTitle,
      description: s.ogDescription,
      type: "article",
      url: s.canonicalUrl,
      publishedTime: post.publishedAt,
    },
    twitter: {
      card: "summary_large_image",
      title: s.twitterTitle,
      description: s.twitterDescription,
    },
  };
}

function prettyCategory(c: string): string {
  return c.replace(/-/g, " ");
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await blogReaderService.getPostBySlug(slug);
  if (!post) notFound();

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <article className="mx-auto max-w-3xl px-6 pb-16 pt-32 md:pt-40">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          {prettyCategory(post.category)}
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium md:text-4xl">{post.title}</h1>
        <p className="mt-3 text-sm text-text-3">
          Published{" "}
          {new Date(post.publishedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>

        {post.summary && <p className="mt-6 text-lg leading-8 text-text-2">{post.summary}</p>}

        <div className="mt-8 space-y-6">
          {post.sections.map((section, i) => (
            <section key={i}>
              {section.heading && <h2 className="text-xl font-semibold text-text">{section.heading}</h2>}
              <p className="mt-2 whitespace-pre-wrap leading-8 text-text-2">{section.body}</p>
            </section>
          ))}
        </div>

        <Disclaimer text={post.disclaimer} className="mt-10" />
      </article>
      <Footer />
    </main>
  );
}
