// app/api/license/deactivate/route.ts
// Sprint M11 - Runtime-facing license API. Idempotent by design -
// deactivating an already-inactive or nonexistent device binding is a
// safe no-op (the caller's desired end-state is already true), never an
// error.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { deactivateLicense } from "@/services/licensing/licenseService";

interface DeactivateBody {
  licenseId?: unknown;
  apiKey?: unknown;
  deviceInfo?: unknown;
}

export const POST = withContext(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as DeactivateBody | null;
  if (!body || typeof body.licenseId !== "string" || typeof body.apiKey !== "string" || typeof body.deviceInfo !== "object" || body.deviceInfo === null) {
    return ApiResponse.error({ code: "VALIDATION", message: "licenseId, apiKey (string), and deviceInfo (object) are required." }, ctx.requestId, 400, ctx.startedAt);
  }
  const deviceInfo = body.deviceInfo as Record<string, unknown>;
  const rawDeviceInfo: Record<string, string> = {};
  for (const [k, v] of Object.entries(deviceInfo)) {
    if (typeof v === "string") rawDeviceInfo[k] = v;
  }

  const result = await deactivateLicense({ licenseId: body.licenseId, rawApiKey: body.apiKey, rawDeviceInfo });

  if (!result.ok) {
    if (result.code === "UNAUTHORIZED") {
      return ApiResponse.error({ code: "UNAUTHORIZED", message: "Invalid licenseId or apiKey." }, ctx.requestId, 401, ctx.startedAt);
    }
    return ApiResponse.error({ code: "UNKNOWN_PLATFORM", message: "This license's platform has no registered adapter." }, ctx.requestId, 400, ctx.startedAt);
  }

  return ApiResponse.success({ deactivated: true }, ctx.requestId, 200, ctx.startedAt);
});
