// app/api/license/validate/route.ts
// Sprint M11 - Runtime-facing license API. Read-mostly (only touches
// Activation.lastValidatedAt on success) - safe to call repeatedly/replay,
// by design, rather than needing a separate nonce scheme (see
// M11_api_contract.md "Replay protection").
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { validateLicenseRuntime } from "@/services/licensing/licenseService";

interface ValidateBody {
  licenseId?: unknown;
  apiKey?: unknown;
  buyerId?: unknown;
  tradingSystemId?: unknown;
  versionId?: unknown;
  releaseId?: unknown;
  platform?: unknown;
  deviceInfo?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export const POST = withContext(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as ValidateBody | null;
  if (
    !body ||
    !isNonEmptyString(body.licenseId) ||
    !isNonEmptyString(body.apiKey) ||
    !isNonEmptyString(body.buyerId) ||
    !isNonEmptyString(body.tradingSystemId) ||
    !isNonEmptyString(body.versionId) ||
    !isNonEmptyString(body.releaseId) ||
    !isNonEmptyString(body.platform) ||
    typeof body.deviceInfo !== "object" ||
    body.deviceInfo === null
  ) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "licenseId, apiKey, buyerId, tradingSystemId, versionId, releaseId, platform (all non-empty strings), and deviceInfo (object) are required." },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const deviceInfo = body.deviceInfo as Record<string, unknown>;
  const rawDeviceInfo: Record<string, string> = {};
  for (const [k, v] of Object.entries(deviceInfo)) {
    if (typeof v === "string") rawDeviceInfo[k] = v;
  }

  const result = await validateLicenseRuntime({
    licenseId: body.licenseId,
    rawApiKey: body.apiKey,
    buyerId: body.buyerId,
    tradingSystemId: body.tradingSystemId,
    versionId: body.versionId,
    releaseId: body.releaseId,
    platform: body.platform,
    rawDeviceInfo,
  });

  if (!result.ok && result.reason === "UNAUTHORIZED") {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: result.detail }, ctx.requestId, 401, ctx.startedAt);
  }

  // Every OTHER outcome (including every RuntimeValidationFailure) is a
  // normal, successful HTTP response carrying an explicit ok:true/false -
  // the caller already proved license possession via apiKey; a 200 with
  // ok:false is the correct shape for "your license doesn't currently
  // authorize this run," not an HTTP-level error.
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
