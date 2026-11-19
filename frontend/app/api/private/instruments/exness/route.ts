// app/api/private/instruments/exness/route.ts
// GET -> the instruments the Exness account lists (read from the Exness Trading API), grouped for the Pro Chart picker.
// Signed-in users only. When the Exness API is off or fails, the list is empty and the picker falls back to its small built-in set.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { listExnessInstruments } from "@/lib/market-data/exness-instruments";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const instruments = await listExnessInstruments();
  const res = ApiResponse.success({ instruments, source: instruments.length > 0 ? "exness" : "none" }, ctx.requestId, 200, ctx.startedAt);
  res.headers.set("Cache-Control", "private, max-age=0, s-maxage=600, stale-while-revalidate=600");
  return res;
});
