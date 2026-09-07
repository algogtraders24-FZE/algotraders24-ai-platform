// app/api/private/intelligence/calendar/route.ts
// AN2 - the AI Economic Calendar read API. Follows the AI News route
// (app/api/private/intelligence/news/route.ts) exactly: withContext +
// getUserOrNull gate, ApiResponse envelope, query params validated against
// known sets and rejected with 400 otherwise.
//
// Unlike the news route this one has no store - it reads the FairEconomy
// feed through calendar.service and lets Next.js cache the upstream fetch
// (calendarCacheTtlSeconds). A CDN Cache-Control header is set so the edge
// also holds the shaped response briefly.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getEconomicCalendar } from "@/services/calendar/calendar.service";
import { CalendarProviderError } from "@/services/calendar/faireconomy.provider";
import { calendarCacheTtlSeconds } from "@/services/calendar/config";
import { CALENDAR_WEEKS, ECONOMIC_IMPACTS, isCalendarWeek, isEconomicImpact, type CalendarWeek, type EconomicImpact } from "@/types/economic-calendar";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);

  let week: CalendarWeek = "this";
  const weekParam = url.searchParams.get("week");
  if (weekParam !== null) {
    if (!isCalendarWeek(weekParam)) {
      return ApiResponse.error(
        { code: "VALIDATION", message: `week must be one of: ${CALENDAR_WEEKS.join(", ")}` },
        ctx.requestId,
        400,
        ctx.startedAt,
      );
    }
    week = weekParam;
  }

  let currencies: string[] | undefined;
  const currencyParam = url.searchParams.get("currency");
  if (currencyParam) {
    currencies = currencyParam
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    // Currency codes are free-form (the feed's own set drifts) - only
    // shape-check, don't reject unknown codes.
    if (currencies.some((c) => !/^[A-Z]{2,4}$/.test(c))) {
      return ApiResponse.error({ code: "VALIDATION", message: "currency must be comma-separated ISO-like codes" }, ctx.requestId, 400, ctx.startedAt);
    }
  }

  let impacts: EconomicImpact[] | undefined;
  const impactParam = url.searchParams.get("impact");
  if (impactParam) {
    const parts = impactParam.split(",").map((p) => p.trim().toLowerCase());
    const unknown = parts.filter((p) => !isEconomicImpact(p));
    if (unknown.length > 0) {
      return ApiResponse.error(
        { code: "VALIDATION", message: `impact must be one of: ${ECONOMIC_IMPACTS.join(", ")}` },
        ctx.requestId,
        400,
        ctx.startedAt,
      );
    }
    impacts = parts.filter(isEconomicImpact);
  }

  try {
    const result = await getEconomicCalendar({ week, currencies, impacts });
    const res = ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
    const ttl = calendarCacheTtlSeconds();
    res.headers.set("Cache-Control", `private, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    return res;
  } catch (error) {
    if (error instanceof CalendarProviderError) {
      return ApiResponse.error(
        { code: "UPSTREAM_UNAVAILABLE", message: "The economic calendar feed is temporarily unavailable. Try again shortly." },
        ctx.requestId,
        502,
        ctx.startedAt,
      );
    }
    throw error;
  }
});
