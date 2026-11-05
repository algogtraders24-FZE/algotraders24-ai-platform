// app/api/marketplace/promo/route.ts
// Public, read-only promo-code check for the Marketplace buy box (same reasoning
// as ../search: the price a visitor would pay is not a secret). The payment
// routes re-validate the code themselves; this only drives the UI.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { resolvePromo } from "@/lib/marketplace/promo";

export const GET = withContext(async (req, ctx) => {
  const code = new URL(req.url).searchParams.get("code");
  const promo = resolvePromo(code);
  if (!promo) {
    return ApiResponse.success({ valid: false }, ctx.requestId, 200, ctx.startedAt);
  }
  return ApiResponse.success(
    { valid: true, code: promo.code, percentOff: promo.percentOff, endsAt: promo.endsAt, label: promo.label },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
