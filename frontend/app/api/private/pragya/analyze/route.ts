// app/api/private/pragya/analyze/route.ts
// POST { symbol, timeframe, facts } -> { text }   PRAGYA, the platform's Gemini assistant, writes a short chart analysis from MEASURED facts.
// The answer is accepted only if every number in it traces back to the facts and it makes no promise or win-rate claim (lib/ai/pragya-guard.ts);
// otherwise the route answers 422 and the chart keeps showing its measured readout. Signed-in users only; a daily cap per user bounds the cost.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { GeminiProvider } from "@/lib/ai/providers/gemini.provider";
import { cleanProse, containsForbiddenClaim, numbersAreSupported } from "@/lib/ai/pragya-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAILY_LIMIT = 30;
const usage = new Map<string, { day: string; n: number }>();

function underLimit(userId: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(userId);
  if (!u || u.day !== day) { usage.set(userId, { day, n: 1 }); return true; }
  if (u.n >= DAILY_LIMIT) return false;
  u.n += 1;
  return true;
}

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  let body: { symbol?: unknown; timeframe?: unknown; facts?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const symbol = typeof body.symbol === "string" ? body.symbol.slice(0, 24) : "";
  const timeframe = typeof body.timeframe === "string" ? body.timeframe.slice(0, 6) : "";
  const facts = typeof body.facts === "string" ? body.facts.slice(0, 2500) : "";
  if (!symbol || !timeframe || facts.length < 40) return ApiResponse.error({ code: "VALIDATION", message: "symbol, timeframe and facts are required." }, ctx.requestId, 400, ctx.startedAt);
  if (!underLimit(user.authId)) return ApiResponse.error({ code: "RATE_LIMITED", message: "Daily PRAGYA analysis limit reached." }, ctx.requestId, 429, ctx.startedAt);

  const prompt = [
    "You are PRAGYA, the market assistant of AT24. Write a market analysis for a trader in 4 to 5 short plain sentences (no lists, no markdown, no headings).",
    `Instrument: ${symbol}, timeframe ${timeframe}.`,
    "Use ONLY the measured facts below. Do not add any number that is not in the facts. Do not predict, promise or guarantee anything, do not quote a win rate or probability.",
    "If the facts contain a plan, describe its entry, stop and target as an educational plan with its risk. If there is no plan, say why waiting is sensible.",
    "Facts:",
    facts,
  ].join("\n");

  try {
    const res = await new GeminiProvider().complete({ messages: [{ role: "user", content: prompt }], temperature: 0.3, maxTokens: 400 });
    const text = cleanProse(res.content ?? "");
    if (text.length < 40) return ApiResponse.error({ code: "UNUSABLE", message: "No usable analysis." }, ctx.requestId, 422, ctx.startedAt);
    if (containsForbiddenClaim(text)) return ApiResponse.error({ code: "UNUSABLE", message: "Analysis rejected by the platform's claim rules." }, ctx.requestId, 422, ctx.startedAt);
    const check = numbersAreSupported(text, facts);
    if (!check.ok) return ApiResponse.error({ code: "UNUSABLE", message: "Analysis rejected: it contained numbers that are not in the measured facts." }, ctx.requestId, 422, ctx.startedAt);
    return ApiResponse.success({ text, model: res.model }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "PRAGYA is not available right now." }, ctx.requestId, 503, ctx.startedAt);
  }
});
