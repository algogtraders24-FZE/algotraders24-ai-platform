// app/social/card/blog/[slug]/card.jpg/route.tsx
// Share card (1080x1080 JPEG) for a published blog analysis: title, category, date. 404 when the post is not published.
import { blogReaderService } from "@/services/publishing/blog-reader.service";
import { CARD_BG, CARD_GOLD, CARD_MUTED, CARD_TEXT, renderJpeg } from "@/lib/social/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await blogReaderService.getPostBySlug(slug).catch(() => null);
  if (!post) return new Response("not found", { status: 404 });
  const category = post.category.replace(/-/g, " ").toUpperCase();
  const date = post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  return renderJpeg(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: CARD_BG, color: CARD_TEXT }}>
      <div style={{ display: "flex", fontSize: 30, color: CARD_GOLD, letterSpacing: 5 }}>{`ALGOTRADERS24 AI  ·  ${category}`}</div>
      <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.15 }}>{post.title.slice(0, 120)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: CARD_MUTED }}>
        <div style={{ display: "flex" }}>{date}</div>
        <div style={{ display: "flex" }}>Evidence-based. Not financial advice.</div>
      </div>
    </div>,
    1080,
    1080,
  );
}
