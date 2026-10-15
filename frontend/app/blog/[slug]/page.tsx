// app/blog/[slug]/page.tsx
// AT24 Publishing Engine (P2.5) - a public blog article. Server Component.
// Visible ONLY when blogReaderService.getPostBySlug returns a post (a
// SUCCEEDED INTERNAL_BLOG job whose content still matches the published
// version). Content is sanitized plain text; rendered as plain React text
// children - the reader never injects raw HTML. The one exception is the
// schema.org JSON-LD <script>, built with JSON.stringify and "<"-escaped.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Disclaimer from "@/components/ui/Disclaimer";
import { blogReaderService } from "@/services/publishing/blog-reader.service";
import { breadcrumbJsonLd, jsonLdString } from "@/lib/seo/seo";

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

  const related = (await blogReaderService.listPosts().catch(() => []))
    .filter((p) => p.slug !== post.slug && p.category === post.category)
    .slice(0, 3);

  // schema.org Article. Plain text only (sanitized upstream); "<" is escaped so the
  // JSON can never close the script tag.
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.summary || post.seo.description,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    mainEntityOfPage: post.seo.canonicalUrl,
    articleSection: prettyCategory(post.category),
    keywords: post.seo.keywords.join(", "),
    author: { "@type": "Organization", name: "Algotraders24 AI", url: "https://algotraders24.ai" },
    publisher: { "@type": "Organization", name: "Algotraders24 AI", url: "https://algotraders24.ai" },
  }).replace(/</g, "\\u003c");

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <article className="mx-auto max-w-3xl px-6 pb-16 pt-32 md:pt-40">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: post.title, path: `/blog/${post.slug}` }])) }}
        />
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
        <p className="mt-1 text-xs text-text-3">
          By Algotraders24 AI - automated, evidence-based analysis.{" "}
          <Link href="/methodology" className="text-gold hover:underline">
            How this report is made
          </Link>
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

        <nav aria-label="Related" className="mt-10 space-y-6 border-t border-border pt-8">
          {related.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-3">More {prettyCategory(post.category)}</h2>
              <ul className="mt-3 space-y-2">
                {related.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/blog/${p.slug}`} className="text-text-2 hover:text-gold">
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm leading-7 text-text-3">
            Explore the{" "}
            <Link href="/marketplace" className="text-gold hover:underline">
              Expert Advisor marketplace
            </Link>
            , build a strategy with{" "}
            <Link href="/quant-lite" className="text-gold hover:underline">
              Quant Lite
            </Link>
            , or browse{" "}
            <Link href="/blog" className="text-gold hover:underline">
              all reports
            </Link>
            .
          </p>
        </nav>
      </article>
      <Footer />
    </main>
  );
}
