// app/api/private/swing-lab/scoreboard/route.ts
// Swing Lab forward scoreboard (rules in services/swing-lab/scoreboard.ts, fixed before any result existed).
//   GET -> { pooled, groups, rows, open, done, since }
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getSwingScoreboard } from "@/services/swing-lab/scoreboard.service";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const res = ApiResponse.success(await getSwingScoreboard(), ctx.requestId, 200, ctx.startedAt);
  res.headers.set("Cache-Control", "private, max-age=0, s-maxage=300, stale-while-revalidate=300");
  return res;
});
