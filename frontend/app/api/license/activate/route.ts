// app/api/license/activate/route.ts
// Sprint M11 - Runtime-facing license API (brief section 8). NOT under
// /api/private - the caller here is a trading product runtime (an MT5
// terminal, a cTrader cBot host, ...), which has no browser/Supabase
// session cookie. Authentication is the license's own apiKey (see
// services/licensing/crypto.ts hashApiKey/verifyApiKey), presented in the
// JSON body, never in a query string or URL.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { activateLicense } from "@/services/licensing/licenseService";

interface ActivateBody {
  licenseId?: unknown;
  apiKey?: unknown;
  deviceInfo?: unknown;
  deviceLabel?: unknown;
}

export const POST = withContext(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as ActivateBody | null;
  if (!body || typeof body.licenseId !== "string" || typeof body.apiKey !== "string" || typeof body.deviceInfo !== "object" || body.deviceInfo === null) {
    return ApiResponse.error({ code: "VALIDATION", message: "licenseId, apiKey (string), and deviceInfo (object) are required." }, ctx.requestId, 400, ctx.startedAt);
  }
  const deviceInfo = body.deviceInfo as Record<string, unknown>;
  const rawDeviceInfo: Record<string, string> = {};
  for (const [k, v] of Object.entries(deviceInfo)) {
    if (typeof v === "string") rawDeviceInfo[k] = v;
  }

  const result = await activateLicense({
    licenseId: body.licenseId,
    rawApiKey: body.apiKey,
    rawDeviceInfo,
    deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel : "",
  });

  if (!result.ok) {
    if (result.code === "UNAUTHORIZED") {
      return ApiResponse.error({ code: "UNAUTHORIZED", message: "Invalid licenseId or apiKey." }, ctx.requestId, 401, ctx.startedAt);
    }
    if (result.code === "UNKNOWN_PLATFORM") {
      return ApiResponse.error({ code: "UNKNOWN_PLATFORM", message: "This license's platform has no registered adapter." }, ctx.requestId, 400, ctx.startedAt);
    }
    return ApiResponse.error({ code: result.code, message: result.detail }, ctx.requestId, 409, ctx.startedAt);
  }

  return ApiResponse.success({ activationId: result.activationId, deviceBindingId: result.deviceBindingId, reactivated: result.reactivated }, ctx.requestId, 200, ctx.startedAt);
});
