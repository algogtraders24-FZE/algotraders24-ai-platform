// app/api/private/seo/indexnow/route.ts
// Daily IndexNow ping: market hubs and the scoreboard (they change every day), plus blog posts published and listings updated in the
// last 30 hours. Auth = valid CRON_SECRET or an authenticated admin (never a plain logged-in user); the path is listed in
// CRON_SECRET_EXEMPT_PATHS in frontend/proxy.ts and in frontend/vercel.json.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { blogReaderService } from "@/services/publishing/blog-reader.service";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import { MARKETS } from "@/services/markets/hub";
import { pingIndexNow } from "@/services/seo/indexnow";
import { SITE_URL } from "@/lib/seo/seo";

export const maxDuration = 60;

async function run() {
  const [posts, listings] = await Promise.all([
    blogReaderService.listPosts().catch(() => []),
    MarketplaceCatalogue.getAllForSitemap().catch(() => []),
  ]);
  return pingIndexNow(SITE_URL, {
    alwaysFresh: ["/markets", ...MARKETS.map((m) => `/markets/${m.slug}`), "/calibration"],
    posts: posts.map((p) => ({ slug: p.slug, publishedAt: p.publishedAt ?? null })),
    listings,
  });
}

const handler = withContext(async (req: Request, ctx: { requestId: string; startedAt: number }) => {
  if (isValidCronSecret(req)) {
    return ApiResponse.success({ trigger: "cron", ...(await run()) }, ctx.requestId, 200, ctx.startedAt);
  }
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  return ApiResponse.success({ trigger: "admin-manual", ...(await run()) }, ctx.requestId, 200, ctx.startedAt);
});

export const GET = handler;
export const POST = handler;
