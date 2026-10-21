// app/api/private/trial/start/route.ts
// POST { "product": "XXXUS30" } -> starts (or returns) the signed-in user's 30-day free DEMO licence for that product.
// Idempotent: a second call returns the same licence. The email "your demo is ready" is sent only the first time.
import { after } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { startTrial } from "@/services/trial/trialService";
import { sendTrialEmail } from "@/services/trial/trialEmails";

export const maxDuration = 30;

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Please sign in to start the free demo." }, ctx.requestId, 401, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { product?: unknown } | null;
  const product = typeof body?.product === "string" ? body.product : "";
  const r = await startTrial({ id: user.profile.id, emailVerified: user.profile.emailVerified }, product);
  if (!r.ok) {
    const status = r.code === "NOT_VERIFIED" ? 403 : r.code === "BUSY" ? 429 : r.code === "UNKNOWN_PRODUCT" ? 404 : 503;
    return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, status, ctx.startedAt);
  }
  if (!r.already) {
    // After the response is sent: a mail problem must never block the user from getting the demo.
    after(() => sendTrialEmail("WELCOME", { userId: user.profile.id, email: user.profile.email, licenseId: r.licenseId, productId: product, expiresAt: r.expiresAt }).catch(() => undefined));
  }
  return ApiResponse.success({ licenseId: r.licenseId, expiresAt: r.expiresAt, already: r.already }, ctx.requestId, r.already ? 200 : 201, ctx.startedAt);
});
