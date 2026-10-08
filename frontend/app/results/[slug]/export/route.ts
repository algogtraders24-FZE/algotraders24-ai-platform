// app/results/[slug]/export/route.ts
// Download a Live Results page as CSV or PDF:  /results/<slug>/export?format=csv|pdf[&k=<unlisted key>]
// Same access rule as the page (public / unlisted with its key / owner / admin) and built from the SAME redacted
// view model, so a download never contains more than the page shows (percent-only unless the owner shows amounts).
import { loadResults } from "@/services/live-results/prisma-store";
import { renderResultsPdf, resultsCsv } from "@/services/live-results/export";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { LISTING_SLUG_RE } from "@/services/live-results/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  if (!LISTING_SLUG_RE.test(slug) || (format !== "csv" && format !== "pdf")) return new Response("Not found", { status: 404 });
  const k = url.searchParams.get("k");
  const user = await getUserOrNull().catch(() => null);
  const res = await loadResults(slug, { userId: user ? user.profile.id : null, key: typeof k === "string" ? k : null, isAdmin: user?.profile.role === "admin" });
  if (res.state !== "ok") return new Response("Not found", { status: 404 });

  // Only a PUBLIC page's file is the same for everyone and may be cached; anything else depends on the viewer.
  const cache = res.visibility === "public" ? "public, s-maxage=60, stale-while-revalidate=120" : "private, no-store";
  const now = new Date();
  const base = `${slug}-live-results-${now.toISOString().slice(0, 10)}`;
  if (format === "csv") {
    return new Response(resultsCsv(res.results, now.toISOString().slice(0, 10)), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"`, "cache-control": cache, "x-content-type-options": "nosniff" },
    });
  }
  const bytes = await renderResultsPdf(res.results, now);
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"`, "cache-control": cache, "x-content-type-options": "nosniff" },
  });
}
