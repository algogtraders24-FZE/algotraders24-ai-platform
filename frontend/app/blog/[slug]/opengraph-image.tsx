// app/blog/[slug]/opengraph-image.tsx
// Per-article share card (PNG) for link previews (X, Telegram, WhatsApp, LinkedIn). Built only from the published article's own
// public fields: title, category and publication date. Falls back to a plain brand card when the post is not found.
import { ImageResponse } from "next/og";
import { blogReaderService } from "@/services/publishing/blog-reader.service";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "Algotraders24 AI market analysis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await blogReaderService.getPostBySlug(slug).catch(() => null);
  const title = (post?.title ?? "Algotraders24 AI - market analysis").slice(0, 110);
  const category = post ? post.category.replace(/-/g, " ").toUpperCase() : "MARKET INTELLIGENCE";
  const date = post?.publishedAt ? new Date(post.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#0b0d12", color: "#f3f4f6" }}>
        <div style={{ display: "flex", fontSize: 30, color: "#d4a73c", letterSpacing: 4 }}>{`ALGOTRADERS24 AI  ·  ${category}`}</div>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.15, maxWidth: 1050 }}>{title}</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "#9ca3af" }}>
          <span>{date}</span>
          <span>Evidence-based. Not financial advice.</span>
        </div>
      </div>
    ),
    size,
  );
}
