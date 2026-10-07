// app/api/private/live-sync/analyze/route.ts
// Edge analysis of a SYNCED account (no file upload needed).
//   GET ?accountId=...   -> same access-gated response as the report-upload analyzer
// Session-authenticated; the account must belong to the session user. Uses the
// same engine as the report upload (analyzeTrades) and the same server-side
// plan gating (free = summary, paid = full). Nothing is stored.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { createBurstLimiter } from "@/services/mcp/quota";
import { analyzeTrades } from "@/services/edge-analyzer";
import { toAccessResponse, type EdgeAnalyzeResponse } from "@/services/edge-analyzer/access";
import { hasQuantProAccess } from "@/lib/access/quant-pro";
import { dealsToHistory } from "@/services/live-sync/to-trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DEALS = 50_000;
const limiter = createBurstLimiter(6);

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!limiter.allow(user.profile.id)) {
    return ApiResponse.error({ code: "RATE_LIMITED", message: "Too many analyses. Please wait a minute and try again." }, ctx.requestId, 429, ctx.startedAt);
  }
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return ApiResponse.error({ code: "BAD_REQUEST", message: "accountId is required" }, ctx.requestId, 400, ctx.startedAt);

  try {
    const account = await prisma.liveSyncAccount.findFirst({ where: { id: accountId, userId: user.profile.id } });
    if (!account) return ApiResponse.error({ code: "NOT_FOUND", message: "Account not found" }, ctx.requestId, 404, ctx.startedAt);

    const rows = await prisma.liveSyncDeal.findMany({
      where: { accountId: account.id },
      orderBy: { timeMsc: "asc" },
      take: MAX_DEALS,
      select: { positionId: true, timeMsc: true, symbol: true, type: true, entry: true, volume: true, price: true, commission: true, swap: true, profit: true, fee: true, comment: true },
    });
    const history = dealsToHistory(
      rows.map((r) => ({ ...r, positionId: r.positionId.toString(), timeMsc: Number(r.timeMsc) })),
    );
    if (history.trades.length === 0) {
      return ApiResponse.error({ code: "NO_TRADES", message: "No closed trades have been synced yet." }, ctx.requestId, 400, ctx.startedAt);
    }

    const warnings: string[] = [];
    if (rows.length >= MAX_DEALS) warnings.push(`Only the first ${MAX_DEALS} synced deals were analyzed.`);
    if (history.missingOpen > 0) warnings.push(`${history.missingOpen} closed position(s) were skipped because their opening deal is not in the synced history.`);
    const first = history.balanceOps[0];
    const report = analyzeTrades({
      meta: {
        platform: "MT5",
        currency: account.currency,
        accountMode: account.mode as "demo" | "real" | "contest",
        hedging: account.marginMode === "hedging",
        reportDate: null,
        initialDeposit: first && first.amount > 0 ? first.amount : null,
      },
      trades: history.trades,
      balanceOps: history.balanceOps,
      reported: null,
      warnings,
    });

    let full = false;
    try {
      full = await hasQuantProAccess(user.profile.id);
    } catch {
      full = false;
    }
    const response: EdgeAnalyzeResponse = toAccessResponse(report, full);
    return ApiResponse.success(response, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
