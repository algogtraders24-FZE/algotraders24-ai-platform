// app/api/private/intelligence/overview/route.ts
// Sprint D2.8.16 - powers the reframed "AI Signals" page (now a regime/
// evidence overview, never a BUY/SELL generator - see the sprint's report
// and types/market-regime-overview.ts for why). Fans out to the SAME
// ResearchSnapshotService the Workspace Research panel and the Workspace
// AI Intelligence panel (D2.8.16's own unification) already call, for a
// fixed set of core instruments - no second engine, no second Intelligence
// Score. One symbol's failure never takes down the others: each call is
// independently caught and honestly reported as "insufficient-data".
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { ResearchSnapshotService } from "@/services/intelligence/chat/research-snapshot.service";
import type { MarketRegimeOverviewItem } from "@/types/market-regime-overview";

const researchSnapshotService = new ResearchSnapshotService();

// Sprint D2.8.16 - the same 7-instrument set app/dashboard/market-intelligence/page.tsx
// already uses (Twelve Data's current real coverage), not a new list - see
// that page's own AVAILABLE_MARKETS comment for the provider-coverage
// rationale.
const OVERVIEW_MARKETS: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: "EURUSD", name: "Euro / US Dollar" },
  { symbol: "GBPUSD", name: "British Pound / US Dollar" },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen" },
  { symbol: "XAUUSD", name: "Gold Spot / US Dollar" },
  { symbol: "XAGUSD", name: "Silver Spot / US Dollar" },
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar" },
  { symbol: "ETHUSD", name: "Ethereum / US Dollar" },
];

async function buildOverviewItem(userId: string, requestId: string, market: { symbol: string; name: string }): Promise<MarketRegimeOverviewItem> {
  try {
    const { context, verifiedAnswer } = await researchSnapshotService.build({
      requestId: `${requestId}:${market.symbol}`,
      userId,
      symbol: market.symbol,
    });

    if (context.status === "resolved" && verifiedAnswer) {
      return {
        symbol: market.symbol,
        name: market.name,
        status: "resolved",
        timeframe: verifiedAnswer.marketContext.timeframe,
        regimeType: verifiedAnswer.marketContext.regimeType,
        decisionState: verifiedAnswer.decisionState,
        intelligenceScore: verifiedAnswer.intelligenceScore.overallScore,
        riskLevel: verifiedAnswer.riskContext.overallLevel,
        basis: verifiedAnswer.currentState.basis[0],
        generatedAt: verifiedAnswer.generatedAt,
      };
    }
    if (context.status === "insufficient-data") {
      return { symbol: market.symbol, name: market.name, status: "insufficient-data" };
    }
    return { symbol: market.symbol, name: market.name, status: "unresolved" };
  } catch {
    // A single symbol's failure is reported honestly, never fabricated and
    // never allowed to fail the whole overview for every other symbol.
    return { symbol: market.symbol, name: market.name, status: "unresolved" };
  }
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const items = await Promise.all(OVERVIEW_MARKETS.map((market) => buildOverviewItem(sessionUser.profile.id, ctx.requestId, market)));

  return ApiResponse.success({ items }, ctx.requestId, 200, ctx.startedAt);
});
