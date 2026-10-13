// app/api/private/dashboard/next-event/route.ts
// The next high-impact USD event this week (dashboard "Next risk event" card).
// Session-scoped; read-only. A calendar outage returns `event: null` with
// `available: false` - the card says so, it never invents an event.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getEconomicCalendar } from "@/services/calendar/calendar.service";
import { pickNextHighImpactEvent } from "@/services/calendar/next-event";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  try {
    const cal = await getEconomicCalendar({ week: "this", currencies: ["USD"], impacts: ["high"] });
    return ApiResponse.success({ available: true, event: pickNextHighImpactEvent(cal.events, new Date()), source: cal.freshness.source }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.success({ available: false, event: null, source: null }, ctx.requestId, 200, ctx.startedAt);
  }
});
