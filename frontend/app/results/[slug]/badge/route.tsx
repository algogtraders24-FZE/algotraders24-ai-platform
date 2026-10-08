// app/results/[slug]/badge/route.tsx
// A shareable PNG badge for a PUBLIC Live Results page (forums, Telegram, a seller's own site).
// Percentages and counts only (built from the redacted public view model). Cached for 5 minutes.
// Used as <img src=".../results/<slug>/badge"> linking to /results/<slug>. Non-public pages: 404.
import { ImageResponse } from "next/og";
import BadgeImage, { BADGE_H, BADGE_W } from "@/components/live-results/BadgeImage";
import { loadResults } from "@/services/live-results/prisma-store";
import { badgeFacts } from "@/services/live-results/badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,78}$/.test(slug)) return new Response("Not found", { status: 404 });
  const res = await loadResults(slug, { userId: null, key: null });
  if (res.state !== "ok" || res.visibility !== "public") return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  return new ImageResponse(<BadgeImage f={badgeFacts(res.results)} />, {
    width: BADGE_W,
    height: BADGE_H,
    headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
