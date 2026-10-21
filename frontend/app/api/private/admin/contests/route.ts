// app/api/private/admin/contests/route.ts
// Admin: list contests (GET) and create one (POST { slug, title, tradingSystemId, startsAt, endsAt, magic?, rules?, prizeMonths?, offerPercent?, offerValidDays?, open? }).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { TRIAL_PRODUCTS } from "@/services/trial/trialService";
import { readContestRules } from "@/services/contest/standings";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const rows = await prisma.contest.findMany({ orderBy: { startsAt: "desc" }, include: { _count: { select: { entries: true } } } });
  return ApiResponse.success({ contests: rows.map(({ _count, ...c }) => ({ ...c, entries: _count.entries })) }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = typeof b?.slug === "string" ? b.slug.trim() : "";
  const title = typeof b?.title === "string" ? b.title.trim() : "";
  const product = typeof b?.tradingSystemId === "string" ? b.tradingSystemId : "";
  const startsAt = typeof b?.startsAt === "string" ? new Date(b.startsAt) : null;
  const endsAt = typeof b?.endsAt === "string" ? new Date(b.endsAt) : null;
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug) || title.length < 5 || !TRIAL_PRODUCTS[product] || !startsAt || !endsAt || Number.isNaN(+startsAt) || Number.isNaN(+endsAt) || endsAt <= startsAt) {
    return ApiResponse.error({ code: "VALIDATION", message: "slug (a-z, 0-9, -), title, a known tradingSystemId and valid startsAt < endsAt are required." }, ctx.requestId, 400, ctx.startedAt);
  }
  const int = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : d);
  const row = await prisma.contest.create({
    data: {
      slug,
      title,
      tradingSystemId: product,
      startsAt,
      endsAt,
      status: b?.open === true ? "OPEN" : "DRAFT",
      magic: typeof b?.magic === "string" && /^\d{1,10}$/.test(b.magic) ? b.magic : "33302",
      rules: readContestRules(b?.rules) as unknown as object,
      prizeMonths: int(b?.prizeMonths, 3, 1, 12),
      offerPercent: int(b?.offerPercent, 20, 1, 90),
      offerValidDays: int(b?.offerValidDays, 14, 1, 90),
    },
  });
  return ApiResponse.success({ contest: row }, ctx.requestId, 201, ctx.startedAt);
});
