// app/api/private/live-results/pages/route.ts
// Owner management of Live Results pages (session-authenticated; every query scoped to the session user).
//   GET                     the user's pages + the user's synced accounts with their EA magic numbers
//   POST                    create a page            (body: PageInput)
//   PATCH  ?id=...          update a page            (body: PageInput)
//   PATCH  ?id=...&rotate=1 issue a new secret link  (old unlisted link stops working)
//   DELETE ?id=...          delete a page
// Pages are private by default in the UI; visibility is the owner's explicit choice.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { validatePageInput } from "@/services/live-results/pages";
import { createPage, deletePage, listAccountMagics, listOwnerPages, listSellerListings, rotateKey, updatePage, liveResultsEnabled } from "@/services/live-results/prisma-store";

export const dynamic = "force-dynamic";

const unavailable = (ctx: { requestId: string; startedAt: number }) =>
  ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return unavailable(ctx);
  try {
    const [pages, accounts] = await Promise.all([
      listOwnerPages(user.profile.id),
      prisma.liveSyncAccount.findMany({ where: { userId: user.profile.id }, orderBy: { lastSyncAt: "desc" }, take: 20, select: { id: true, accountKey: true, mode: true } }),
    ]);
    const magics = await listAccountMagics(user.profile.id, accounts.map((a) => a.id));
    const listings = await listSellerListings(user.profile.id).catch(() => []);
    return ApiResponse.success(
      {
        pages,
        listings,
        accounts: accounts.map((a) => ({ id: a.id, label: `Account ${a.accountKey.slice(0, 6)}`, mode: a.mode, magics: magics[a.id] ?? [] })),
      },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return unavailable(ctx);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return unavailable(ctx);
  const body = await req.json().catch(() => null);
  const v = validatePageInput(body);
  if (!v.ok) return ApiResponse.error({ code: "BAD_REQUEST", message: v.message }, ctx.requestId, 400, ctx.startedAt);
  try {
    const r = await createPage(user.profile.id, v.value);
    if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "PAGE_LIMIT" ? 409 : r.code === "LISTING_NOT_FOUND" ? 400 : 404, ctx.startedAt);
    return ApiResponse.success({ page: r.page }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const PATCH = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return unavailable(ctx);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    if (url.searchParams.get("rotate") === "1") {
      const page = await rotateKey(user.profile.id, id);
      if (!page) return ApiResponse.error({ code: "NOT_FOUND", message: "Page not found" }, ctx.requestId, 404, ctx.startedAt);
      return ApiResponse.success({ page }, ctx.requestId, 200, ctx.startedAt);
    }
    const body = await req.json().catch(() => null);
    const v = validatePageInput(body);
    if (!v.ok) return ApiResponse.error({ code: "BAD_REQUEST", message: v.message }, ctx.requestId, 400, ctx.startedAt);
    const r = await updatePage(user.profile.id, id, v.value);
    if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ page: r.page }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return unavailable(ctx);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    if (!(await deletePage(user.profile.id, id))) return ApiResponse.error({ code: "NOT_FOUND", message: "Page not found" }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ deleted: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});
