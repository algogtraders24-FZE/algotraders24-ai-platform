// app/api/public/contests/[slug]/route.ts
// PUBLIC, read-only JSON: one demo contest and its leaderboard (public alias, percent and counts only - never a user id, email or amount).
//   GET /api/public/contests/<slug> -> { status:"ok", data:{ contest, leaderboard, disclaimer } }
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getContest, publicLeaderboard } from "@/services/contest/contestService";
import { readContestRules } from "@/services/contest/standings";

export const dynamic = "force-dynamic";

function slugFromPath(path: string): string | undefined {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  const idx = segments.indexOf("contests");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const slug = slugFromPath(ctx.path);
  const contest = slug && /^[a-z0-9][a-z0-9-]{0,60}$/.test(slug) ? await getContest(slug) : null;
  if (!contest || contest.status === "DRAFT") return ApiResponse.error({ code: "NOT_FOUND", message: "Contest not found" }, ctx.requestId, 404, ctx.startedAt);
  const leaderboard = (await publicLeaderboard(contest.id)).slice(0, 200);
  const res = ApiResponse.success(
    {
      contest: { slug: contest.slug, title: contest.title, status: contest.status, startsAt: contest.startsAt, endsAt: contest.endsAt, rules: readContestRules(contest.rules), prizeMonths: contest.prizeMonths, offerPercent: contest.offerPercent },
      leaderboard,
      disclaimer: "Demo accounts, terminal-reported closed trades, not verified by a broker. Winners are checked by AT24 before a prize is issued.",
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
  res.headers.set("cache-control", "public, s-maxage=120, stale-while-revalidate=300");
  return res;
});
